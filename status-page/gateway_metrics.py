"""
网关指标采集 - 整合多数据源:
  1. Docker logs(实时 HTTP 状态码 + 延迟 + 路由)
  2. NewAPI MySQL `logs` 表(实时 token 用量、按 channel 的 nodes 统计)
  3. health_url 探针(简单 alive 检查)

每个网关由 config 中的 dict 描述,需要哪些数据源由 `use_mysql` 等字段控制。
"""
from __future__ import annotations

import logging
import time
import urllib.request
from collections import defaultdict
from typing import Optional

import pymysql
import pymysql.cursors

import config
import docker_log_collector

logger = logging.getLogger("gateway-metrics")


# ---------- Docker logs 滚动窗口 → 前端 schema ----------
def _percentile(sorted_values: list[int], pct: float) -> int:
    if not sorted_values:
        return 0
    k = max(0, min(len(sorted_values) - 1, int(round(len(sorted_values) * pct / 100)) - 1))
    return sorted_values[k]


def _routes_from_docker_paths(paths: dict) -> dict:
    """把 docker 解析出的 path -> stats 转成前端期望的 routes schema。"""
    out = {}
    for p, pd in paths.items():
        total = pd["count"]
        if total == 0:
            continue
        rate = pd["success"] / total * 100 if total else 100.0
        avg_lat = int(pd["lat_sum"] / total) if total else 0
        out[p] = {
            "requests": {"total": total, "success_rate": round(rate, 1)},
            "tokens": {"total_tokens": 0},   # docker logs 没有 token 信息,后面用 MySQL 补
            "avg_latency_ms": avg_lat,
            "streaming_requests": 0,
            "non_streaming_requests": 0,
        }
    return out


# ---------- NewAPI MySQL → tokens + nodes ----------
def _mysql_conn():
    return pymysql.connect(
        host=config.MYSQL_HOST,
        port=config.MYSQL_PORT,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=5,
        read_timeout=10,
    )


def _route_for_model(model: str) -> str:
    if not model:
        return "/v1/chat/completions"
    m = model.lower()
    if m.startswith("claude") or "anthropic" in m:
        return "/anthropic/v1/messages"
    if "audio" in m or "tts" in m or "speech" in m:
        return "/v1/audio/speech"
    if "image" in m or "draw" in m:
        return "/v1/images/generations"
    if "embed" in m:
        return "/v1/embeddings"
    if "codex" in m or m.startswith("o1") or m.startswith("o3"):
        return "/v1/responses"
    return "/v1/chat/completions"


def _query_mysql_window(window_seconds: int) -> dict:
    """从 NewAPI logs 表聚合 token + node 数据,最近 N 秒。"""
    since = int(time.time()) - window_seconds
    sql = (
        "SELECT model_name, channel_id, channel_name, is_stream, "
        "       prompt_tokens, completion_tokens, use_time, quota "
        "FROM logs WHERE created_at >= %s AND type = 2"
    )
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (since,))
                rows = cur.fetchall()
    except Exception as e:  # noqa: BLE001
        logger.warning("mysql query failed: %s", e)
        return {"tokens_total": 0, "tokens_by_route": {}, "nodes": [], "stream_by_route": {}}

    total_tokens = 0
    tokens_by_route: dict[str, int] = defaultdict(int)
    stream_by_route: dict[str, dict] = defaultdict(lambda: {"stream": 0, "non_stream": 0})

    nodes_acc: dict[int, dict] = defaultdict(
        lambda: {"name": "", "total": 0, "success": 0, "latency_sum_ms": 0}
    )

    for r in rows:
        tokens = (r.get("prompt_tokens") or 0) + (r.get("completion_tokens") or 0)
        total_tokens += tokens
        route = _route_for_model(r.get("model_name") or "")
        tokens_by_route[route] += tokens

        if r.get("is_stream"):
            stream_by_route[route]["stream"] += 1
        else:
            stream_by_route[route]["non_stream"] += 1

        ch_id = r.get("channel_id") or 0
        ch_name = (r.get("channel_name") or f"ch{ch_id}") or f"ch{ch_id}"
        n = nodes_acc[ch_id]
        n["name"] = ch_name
        n["total"] += 1
        # MySQL logs 都是 type=2 消费日志,quota>0 视为成功
        if (r.get("quota") or 0) > 0 or tokens > 0:
            n["success"] += 1
        n["latency_sum_ms"] += int((r.get("use_time") or 0) * 1000)

    nodes_out = []
    for ch_id, n in nodes_acc.items():
        rate = (n["success"] / n["total"] * 100) if n["total"] else 0.0
        avg_lat = int(n["latency_sum_ms"] / n["total"]) if n["total"] else 0
        nodes_out.append(
            {
                "node": n["name"] or f"channel-{ch_id}",
                "available": rate >= 90.0,
                "client_id": str(ch_id),
                "attempts": {"total": n["total"], "success_rate": round(rate, 1)},
                "avg_first_byte_latency_ms": avg_lat,
            }
        )
    nodes_out.sort(key=lambda x: x["attempts"]["total"], reverse=True)

    return {
        "tokens_total": total_tokens,
        "tokens_by_route": dict(tokens_by_route),
        "nodes": nodes_out,
        "stream_by_route": dict(stream_by_route),
    }


# ---------- IP 维度聚合 + 倒卖/滥用告警 ----------
# 阈值(基于"卡密最大 rph=400"做的近似):
#   单 IP 5min 请求数 > IP_HIGH_FREQ_THRESHOLD  → 可疑高频(单人脚本暴打)
#   单 token 出现 IP 数 >= TOKEN_MULTI_IP_THRESHOLD → 可疑账号共享/倒卖
IP_HIGH_FREQ_THRESHOLD = 100      # 5min 内单 IP > 100 = 20 req/min,脚本节奏
TOKEN_MULTI_IP_THRESHOLD = 3      # 5min 内一个 token 出现在 ≥3 个 IP = 嫌疑共享


def _query_mysql_ip_stats(window_seconds: int) -> dict:
    """从 NewAPI logs 表按 IP / token 维度聚合,返回 top IPs 和 abuse_alerts。

    返回:
      {
        "top_ips":      [{ip, requests, tokens, top_token, distinct_tokens, suspicious}, ...] (按 requests 倒序前 10),
        "abuse_alerts": [{token_name, ip_count, request_count, reason, ips, top_ip}, ...]
      }
    """
    since = int(time.time()) - window_seconds
    sql = (
        "SELECT ip, token_name, token_id, user_id, username, "
        "       COUNT(*) AS req, "
        "       SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0)) AS tok "
        "FROM logs WHERE created_at >= %s AND type = 2 AND ip != '' AND ip IS NOT NULL "
        "GROUP BY ip, token_name, token_id, user_id, username"
    )
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (since,))
                rows = cur.fetchall()
    except Exception as e:  # noqa: BLE001
        logger.warning("mysql ip query failed: %s", e)
        return {"top_ips": [], "abuse_alerts": []}

    # 按 IP 聚合(横切 token)
    by_ip: dict[str, dict] = defaultdict(
        lambda: {"requests": 0, "tokens": 0, "tokens_by_token": defaultdict(int), "token_meta": {}}
    )
    # 按 token 聚合(横切 IP)
    by_token: dict[str, dict] = defaultdict(
        lambda: {
            "requests": 0,
            "ips": defaultdict(int),
            "token_name": "",
            "token_id": 0,
            "user_id": 0,
            "username": "",
        }
    )

    for r in rows:
        ip = r["ip"] or ""
        tname = r["token_name"] or "(no-name)"
        token_id = int(r.get("token_id") or 0)
        user_id = int(r.get("user_id") or 0)
        username = r.get("username") or ""
        req = int(r["req"] or 0)
        tok = int(r["tok"] or 0)

        bi = by_ip[ip]
        bi["requests"] += req
        bi["tokens"] += tok
        bi["tokens_by_token"][tname] += req
        bi["token_meta"][tname] = {"token_id": token_id, "user_id": user_id, "username": username}

        token_key = f"{user_id}:{token_id}:{tname}"
        bt = by_token[token_key]
        bt["token_name"] = tname
        bt["token_id"] = token_id
        bt["user_id"] = user_id
        bt["username"] = username
        bt["requests"] += req
        bt["ips"][ip] += req

    # Top IPs
    top_ips = []
    for ip, d in by_ip.items():
        token_top = max(d["tokens_by_token"].items(), key=lambda x: x[1], default=("", 0))
        token_meta = d["token_meta"].get(token_top[0]) or {}
        top_ips.append(
            {
                "ip": ip,
                "requests": d["requests"],
                "tokens": d["tokens"],
                "top_token": token_top[0],
                "top_token_id": token_meta.get("token_id") or 0,
                "top_user_id": token_meta.get("user_id") or 0,
                "top_username": token_meta.get("username") or "",
                "distinct_tokens": len(d["tokens_by_token"]),
                "suspicious": d["requests"] > IP_HIGH_FREQ_THRESHOLD,
            }
        )
    top_ips.sort(key=lambda x: x["requests"], reverse=True)
    top_ips = top_ips[:10]

    # Abuse alerts
    alerts = []
    for _, d in by_token.items():
        ip_count = len(d["ips"])
        req_count = d["requests"]
        reasons = []
        if ip_count >= TOKEN_MULTI_IP_THRESHOLD:
            reasons.append(f"账号共享嫌疑(同时 {ip_count} 个 IP)")
        # 也可顺便对 token 维度做高频检测
        if req_count > IP_HIGH_FREQ_THRESHOLD * 2 and ip_count == 1:
            reasons.append(f"单 IP 暴打({req_count} 次/5min)")
        if not reasons:
            continue
        # 列出 top 3 IP
        ips_sorted = sorted(d["ips"].items(), key=lambda x: x[1], reverse=True)
        top_ip = ips_sorted[0][0] if ips_sorted else ""
        alerts.append(
            {
                "token_name": d["token_name"],
                "token_id": d["token_id"],
                "user_id": d["user_id"],
                "username": d["username"],
                "ip_count": ip_count,
                "request_count": req_count,
                "reason": " · ".join(reasons),
                "ips": [{"ip": ip, "req": req} for ip, req in ips_sorted[:5]],
                "top_ip": top_ip,
            }
        )
    alerts.sort(key=lambda x: (x["ip_count"], x["request_count"]), reverse=True)

    return {"top_ips": top_ips, "abuse_alerts": alerts}


# ---------- 健康探针 ----------
def _probe_health(url: str, timeout: float = 3.0) -> bool:
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "nassa-status-page/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500  # 4xx 也算"还活着"
    except Exception:
        return False


# ---------- 主入口:每个网关一次完整采集 ----------
def collect_gateway(gw_cfg: dict, started_at: float) -> dict:
    """根据网关配置组合多数据源,返回前端 data 结构。"""
    container = gw_cfg.get("container") or ""
    log_format = gw_cfg.get("log_format") or ""
    use_mysql = gw_cfg.get("use_mysql", False)
    health_url = gw_cfg.get("health_url") or ""

    # 1. docker logs 数据(若配置了容器)
    if container and log_format:
        try:
            tailer = docker_log_collector.get_or_create(container, log_format)
            docker_stats = tailer.query(config.REALTIME_WINDOW)
        except Exception as e:  # noqa: BLE001
            logger.warning("docker tailer failed for %s: %s", container, e)
            docker_stats = None
    else:
        docker_stats = None

    # 2. MySQL token + node 数据
    mysql_stats = _query_mysql_window(config.REALTIME_WINDOW) if use_mysql else None

    # 2b. MySQL IP 维度 + 异常告警(独立查,不影响 mysql_stats)
    ip_stats = _query_mysql_ip_stats(config.REALTIME_WINDOW) if use_mysql else None

    # 3. health probe
    is_healthy = _probe_health(health_url) if health_url else None

    # 组装前端 data
    if docker_stats and docker_stats["total"] > 0:
        # 有真实流量数据
        routes = _routes_from_docker_paths(docker_stats["paths"])
        # 把 MySQL 的 token + stream/non_stream 合并到 docker route 里
        if mysql_stats:
            for path, tok in mysql_stats["tokens_by_route"].items():
                if path in routes:
                    routes[path]["tokens"]["total_tokens"] = tok
                else:
                    # MySQL 有数据但 docker logs 里没出现这个路径
                    routes[path] = {
                        "requests": {"total": 0, "success_rate": 100.0},
                        "tokens": {"total_tokens": tok},
                        "avg_latency_ms": 0,
                        "streaming_requests": 0,
                        "non_streaming_requests": 0,
                    }
            for path, sd in mysql_stats["stream_by_route"].items():
                if path in routes:
                    routes[path]["streaming_requests"] = sd["stream"]
                    routes[path]["non_streaming_requests"] = sd["non_stream"]

        # 延迟分布
        lats = docker_stats["latencies_sorted"]
        avg_ms = int(sum(lats) / len(lats)) if lats else 0

        # status_codes:确保前端 keys 是字符串
        sc = {str(k): v for k, v in docker_stats["status_codes"].items()}

        nodes = mysql_stats["nodes"] if mysql_stats else []
        total_tokens = mysql_stats["tokens_total"] if mysql_stats else 0

        data = {
            "uptime_seconds": int(time.time() - started_at),
            "window_seconds": config.REALTIME_WINDOW,
            "nodes": nodes,
            "requests": {
                "total": docker_stats["total"],
                "success_rate": round(docker_stats["success_rate"], 1),
            },
            "latency": {
                "avg_ms": avg_ms,
                "p50_ms": _percentile(lats, 50),
                "p95_ms": _percentile(lats, 95),
                "p99_ms": _percentile(lats, 99),
            },
            "tokens": {"total_tokens": total_tokens},
            "routes": routes,
            "status_codes": sc,
            "top_ips": ip_stats["top_ips"] if ip_stats else [],
            "abuse_alerts": ip_stats["abuse_alerts"] if ip_stats else [],
        }
        return data

    # 没 docker logs 数据,只能给 health 卡片
    if is_healthy is not None:
        # alive + 没流量数据(也要带 window_seconds/top_ips/alerts 让前端 schema 一致)
        data = {
            "uptime_seconds": int(time.time() - started_at),
            "window_seconds": config.REALTIME_WINDOW,
            "nodes": [
                {
                    "node": gw_cfg.get("name", "service"),
                    "available": is_healthy,
                    "client_id": gw_cfg.get("tag", ""),
                    "attempts": {"total": 0, "success_rate": 100.0 if is_healthy else 0.0},
                    "avg_first_byte_latency_ms": 0,
                }
            ],
            "requests": {"total": 0, "success_rate": 100.0 if is_healthy else 0.0},
            "latency": {"avg_ms": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0},
            "tokens": {"total_tokens": 0},
            "routes": {},
            "status_codes": {},
            "top_ips": ip_stats["top_ips"] if ip_stats else [],
            "abuse_alerts": ip_stats["abuse_alerts"] if ip_stats else [],
        }
        return data

    raise RuntimeError("no data source configured for this gateway")


# ---------- 历史桶聚合(用于 history_store)----------
def aggregate_mysql_bucket(bucket_start: int, bucket_end: int) -> dict:
    """聚合某时间桶内的 MySQL 数据,返回 history points 字段。"""
    sql = (
        "SELECT prompt_tokens, completion_tokens, use_time, quota "
        "FROM logs WHERE created_at >= %s AND created_at < %s AND type = 2"
    )
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (bucket_start, bucket_end))
                rows = cur.fetchall()
    except Exception:
        return {
            "bucket_start": bucket_start,
            "bucket_end": bucket_end,
            "status": "no_data",
            "requests_total": 0,
            "requests_succeeded": 0,
            "avg_latency_ms": 0,
        }

    total = len(rows)
    if total == 0:
        return {
            "bucket_start": bucket_start,
            "bucket_end": bucket_end,
            "status": "no_data",
            "requests_total": 0,
            "requests_succeeded": 0,
            "avg_latency_ms": 0,
        }

    success = sum(1 for r in rows if (r.get("quota") or 0) > 0)
    lat_sum = sum(int((r.get("use_time") or 0) * 1000) for r in rows)
    avg_ms = int(lat_sum / total)
    rate = success / total * 100

    if rate >= 99:
        status = "operational"
    elif rate >= 95:
        status = "degraded"
    elif rate >= 80:
        status = "partial_outage"
    else:
        status = "major_outage"

    return {
        "bucket_start": bucket_start,
        "bucket_end": bucket_end,
        "status": status,
        "requests_total": total,
        "requests_succeeded": success,
        "avg_latency_ms": avg_ms,
    }
