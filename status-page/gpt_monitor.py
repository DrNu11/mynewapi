"""GPT/Codex plan status collector.

The collector is intentionally configuration-driven because GPT quota sources
vary by deployment. It can check a ChatGPT/OpenAI access token, a custom health
URL, and optional usage payloads without exposing secrets to the frontend.
"""
from __future__ import annotations

import base64
import json
import logging
import random
import socket
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pymysql
import pymysql.cursors

import config

logger = logging.getLogger("status-page.gpt")

OPENAI_MODELS_URL = "https://api.openai.com/v1/models"
CN_TZ = ZoneInfo("Asia/Shanghai")

_cache_lock = None
_cache_payload: dict[str, Any] | None = None
_cache_at = 0.0
_failure_counts: dict[str, int] = {}


ERROR_MESSAGES = {
    "auth_expired": ("登录态失效", "重新导入 GPT/Codex access_token 或 session JSON"),
    "rate_limited": ("GPT 限流", "稍后自动恢复"),
    "upstream_error": ("GPT 上游异常", "观察下一次刷新,连续失败再切人工检查"),
    "network_error": ("网络异常", "检查 status-page 到 GPT/CPA usage endpoint 的连通性"),
    "schema_error": ("返回结构变化", "需要更新 GPT usage 解析逻辑或改用手动 quota 配置"),
    "http_error": ("HTTP 异常", "查看状态码与响应摘要"),
}


class GPTCollectError(RuntimeError):
    def __init__(self, error_type: str, detail: str):
        super().__init__(detail)
        self.error_type = error_type
        self.detail = detail


def _lock():
    global _cache_lock
    if _cache_lock is None:
        import threading

        _cache_lock = threading.Lock()
    return _cache_lock


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _summarize_body(body: str, limit: int = 180) -> str:
    return " ".join(body.strip().split())[:limit]


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode("utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _parse_time(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.isdigit():
            timestamp = float(text)
            if timestamp > 10_000_000_000:
                timestamp /= 1000
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    return None


def _format_datetime(value: Any) -> str:
    try:
        parsed = _parse_time(value)
    except (TypeError, ValueError, OSError):
        parsed = None
    if not parsed:
        return ""
    return parsed.astimezone(CN_TZ).strftime("%Y-%m-%d %H:%M:%S(UTC+8)")


def _days_until(value: Any) -> int | None:
    try:
        parsed = _parse_time(value)
    except (TypeError, ValueError, OSError):
        return None
    if not parsed:
        return None
    return max(0, int((parsed - datetime.now(timezone.utc)).total_seconds() // 86400))


def _request_json(url: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "accept": "application/json, text/plain, */*",
            "user-agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36"
            ),
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(req, timeout=config.GPT_TIMEOUT_SECONDS) as resp:  # noqa: S310
        body = resp.read().decode("utf-8", errors="replace")
    try:
        data = json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise GPTCollectError("schema_error", f"Invalid JSON: {_summarize_body(body)}") from exc
    if not isinstance(data, dict):
        raise GPTCollectError("schema_error", "GPT endpoint returned a non-object JSON payload")
    return data


def _extract_source(plan: dict[str, Any]) -> dict[str, Any]:
    source: dict[str, Any] = {}
    session = plan.get("session")
    if isinstance(session, str) and session.strip():
        try:
            session = json.loads(session)
        except json.JSONDecodeError:
            session = {}
    if isinstance(session, dict):
        source.update(session)
    source.update(plan)
    return source


def _source_access_token(source: dict[str, Any]) -> str:
    return str(
        source.get("access_token")
        or source.get("accessToken")
        or (source.get("token") or {}).get("access_token")
        or ""
    ).strip()


def _source_email(source: dict[str, Any], claims: dict[str, Any]) -> str:
    profile = claims.get("https://api.openai.com/profile") if isinstance(claims, dict) else {}
    user = source.get("user") if isinstance(source.get("user"), dict) else {}
    return str(source.get("email") or user.get("email") or (profile or {}).get("email") or "").strip()


def _source_plan(source: dict[str, Any], claims: dict[str, Any]) -> str:
    auth = claims.get("https://api.openai.com/auth") if isinstance(claims, dict) else {}
    account = source.get("account") if isinstance(source.get("account"), dict) else {}
    return str(
        source.get("plan_type")
        or source.get("planType")
        or source.get("chatgpt_plan_type")
        or account.get("planType")
        or (auth or {}).get("chatgpt_plan_type")
        or ""
    ).strip()


def _normalize_quota(title: str, raw: dict[str, Any]) -> dict[str, Any] | None:
    total = _num(raw.get("total") or raw.get("limit") or raw.get("quota") or raw.get("cap"))
    used = _num(raw.get("used") or raw.get("usage") or raw.get("consumed"))
    remaining = _num(raw.get("remaining") or raw.get("remain") or raw.get("available") or raw.get("left"))
    percent = raw.get("percent")
    if percent is None:
        percent = raw.get("used_percent") or raw.get("usage_percent")
    if total is None and used is None and remaining is None and percent is None:
        return None
    if total is None and used is not None and remaining is not None:
        total = used + remaining
    if used is None and total is not None and remaining is not None:
        used = max(0, total - remaining)
    if remaining is None and total is not None and used is not None:
        remaining = max(0, total - used)
    if percent is None:
        percent = round((used or 0) / total * 100) if total else 0
    return {
        "title": title,
        "total": int(total or 0),
        "used": int(used or 0),
        "remaining": int(remaining or 0),
        "percent": int(round(float(percent or 0))),
        "time_range": str(raw.get("time_range") or raw.get("range") or raw.get("window") or ""),
        "reset_text": str(raw.get("reset_text") or raw.get("reset") or raw.get("resets_in") or ""),
    }


def _num(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _configured_quotas(source: dict[str, Any]) -> list[dict[str, Any]]:
    raw = source.get("quotas") or source.get("quota") or []
    if isinstance(raw, dict):
        items = raw.items()
    elif isinstance(raw, list):
        items = ((str(item.get("title") or item.get("name") or f"额度 {idx}"), item) for idx, item in enumerate(raw, 1) if isinstance(item, dict))
    else:
        items = []
    out = []
    for key, value in items:
        if isinstance(value, dict):
            quota = _normalize_quota(str(value.get("title") or value.get("name") or key), value)
            if quota:
                out.append(quota)
    return out


def _usage_payload_quotas(payload: dict[str, Any], plan: dict[str, Any]) -> list[dict[str, Any]]:
    account = _select_usage_account(payload, plan)
    candidates = []
    for key in ("quotas", "quota", "usage", "limits"):
        value = account.get(key) if isinstance(account, dict) else None
        if isinstance(value, (dict, list)):
            candidates.append(value)
    if not candidates and any(key in account for key in ("total", "limit", "used", "remaining", "percent")):
        candidates.append({"用量": account})

    out = []
    for candidate in candidates:
        if isinstance(candidate, dict):
            for key, value in candidate.items():
                if isinstance(value, dict):
                    quota = _normalize_quota(str(value.get("title") or value.get("name") or key), value)
                    if quota:
                        out.append(quota)
        elif isinstance(candidate, list):
            for idx, value in enumerate(candidate, 1):
                if isinstance(value, dict):
                    quota = _normalize_quota(str(value.get("title") or value.get("name") or f"额度 {idx}"), value)
                    if quota:
                        out.append(quota)
    return out


def _select_usage_account(payload: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    accounts = payload.get("accounts") or payload.get("data") or payload.get("items")
    if not isinstance(accounts, list):
        return payload
    tag = str(plan.get("tag") or "")
    name = str(plan.get("name") or "")
    for item in accounts:
        if not isinstance(item, dict):
            continue
        if str(item.get("tag") or item.get("id") or "") == tag:
            return item
        if name and str(item.get("name") or "") == name:
            return item
    return accounts[0] if accounts and isinstance(accounts[0], dict) else payload


def _package_from_source(source: dict[str, Any], claims: dict[str, Any]) -> dict[str, Any] | None:
    expires = source.get("expires") or source.get("expiration_time") or source.get("expires_at")
    token_exp = claims.get("exp") if isinstance(claims, dict) else None
    expiration = expires or token_exp
    plan_type = _source_plan(source, claims)
    if not expiration and not plan_type:
        return None
    return {
        "package_name": plan_type or "GPT",
        "expiration_time": expiration,
        "expiration_text": _format_datetime(expiration),
        "days_remaining": _days_until(expiration),
    }


def _collect_account(plan: dict[str, Any]) -> dict[str, Any]:
    start = time.time()
    source = _extract_source(plan)
    token = _source_access_token(source)
    claims = _decode_jwt_payload(token) if token else {}
    item: dict[str, Any] = {
        "tag": str(plan["tag"]),
        "name": str(plan["name"]),
        "ok": False,
        "error": None,
        "error_type": None,
        "error_detail": None,
        "error_action": None,
        "consecutive_failures": 0,
        "updated_at": _iso_now(),
        "latency_ms": None,
        "email": _source_email(source, claims),
        "plan_type": _source_plan(source, claims),
        "usage": None,
        "package": _package_from_source(source, claims),
    }
    try:
        quotas = _configured_quotas(source)
        usage_url = str(source.get("usage_url") or "").strip()
        if usage_url:
            usage_headers = _headers_from_plan(source, token)
            usage_payload = _request_json(usage_url, usage_headers)
            quotas = _usage_payload_quotas(usage_payload, plan) or quotas
            item["raw_status"] = usage_payload.get("status") or usage_payload.get("ok")

        health_url = str(source.get("health_url") or "").strip()
        if health_url:
            _request_json(health_url, _headers_from_plan(source, token))
        elif token:
            _request_json(OPENAI_MODELS_URL, {"authorization": f"Bearer {token}"})

        if not health_url and not token and not quotas:
            raise GPTCollectError("schema_error", "GPT account has no access_token, health_url, or quotas")

        item["ok"] = True
        item["usage"] = {"title": str(source.get("usage_title") or "GPT"), "quotas": quotas}
    except GPTCollectError as exc:
        _set_error(item, exc.error_type, exc.detail)
    except urllib.error.HTTPError as exc:
        detail = _http_error_detail(exc)
        if exc.code in (401, 403):
            _set_error(item, "auth_expired", detail)
        elif exc.code == 429:
            _set_error(item, "rate_limited", detail)
        elif exc.code >= 500:
            _set_error(item, "upstream_error", detail)
        else:
            _set_error(item, "http_error", detail)
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        _set_error(item, "network_error", str(exc))
    except Exception as exc:  # noqa: BLE001
        _set_error(item, "upstream_error", str(exc))
    finally:
        item["latency_ms"] = round((time.time() - start) * 1000)
        item["consecutive_failures"] = _record_result(item["tag"], item["ok"])
    return item


def _collect_usage_db() -> list[dict[str, Any]]:
    if not config.GPT_USAGE_DB:
        return []
    rows = _query_usage_db(config.GPT_USAGE_DB)
    accounts: list[dict[str, Any]] = []
    for row in rows:
        plan_type = str(row.get("plan_type") or "unknown")
        total = int(row.get("accounts") or 0)
        enabled = int(row.get("enabled") or 0)
        success = int(row.get("success") or 0)
        failure = int(row.get("fail") or 0)
        requests = int(row.get("req") or 0)
        tokens = int(row.get("tokens") or 0)
        failure_rate = round(failure / requests * 100) if requests > 0 else 0
        last_used = row.get("last_used") or ""
        nearest_expiry = row.get("nearest_expiry") or None
        accounts.append(
            {
                "tag": f"gpt-{plan_type}",
                "name": f"GPT {plan_type.upper()}",
                "ok": enabled > 0,
                "error": None if enabled > 0 else "没有启用中的 GPT 凭证",
                "error_type": None if enabled > 0 else "upstream_error",
                "error_detail": None if enabled > 0 else f"{enabled}/{total} 凭证启用",
                "error_action": None if enabled > 0 else "检查 cpa-usage-keeper 凭证状态",
                "consecutive_failures": 0 if enabled > 0 else _record_result(f"gpt-{plan_type}", False),
                "updated_at": _iso_now(),
                "latency_ms": 0,
                "email": f"{enabled}/{total} 凭证启用",
                "plan_type": plan_type,
                "usage": {
                    "title": "GPT",
                    "quotas": [
                        {
                            "title": "失败率",
                            "total": requests,
                            "used": failure,
                            "remaining": success,
                            "percent": failure_rate,
                            "time_range": "累计",
                            "reset_text": f"成功 {success:,} 次",
                        },
                        {
                            "title": "累计 Token",
                            "total": tokens,
                            "used": tokens,
                            "remaining": 0,
                            "percent": 100 if tokens else 0,
                            "time_range": last_used,
                            "reset_text": "最近使用",
                        },
                    ],
                },
                "package": {
                    "package_name": plan_type,
                    "expiration_time": nearest_expiry,
                    "expiration_text": _format_datetime(nearest_expiry),
                    "days_remaining": _days_until(nearest_expiry),
                },
            }
        )
        if enabled > 0:
            _record_result(f"gpt-{plan_type}", True)
    return accounts


def _empty_history_points(start_ts: int, bucket_seconds: int, count: int) -> list[dict[str, Any]]:
    return [
        {
            "bucket_start": start_ts + (idx * bucket_seconds),
            "bucket_end": start_ts + ((idx + 1) * bucket_seconds),
            "status": "no_data",
            "requests_total": 0,
            "requests_succeeded": 0,
            "tokens": 0,
            "success_rate": None,
        }
        for idx in range(count)
    ]


def _status_from_success(total: int, success: int) -> str:
    if total <= 0:
        return "no_data"
    rate = success / total * 100
    if rate >= 95:
        return "operational"
    if rate >= 80:
        return "degraded"
    if rate >= 50:
        return "partial_outage"
    return "major_outage"


def _is_failed(value: Any) -> bool:
    if value in (None, "", 0, "0", False):
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "failed", "fail", "error"}
    return bool(value)


def _collect_customer_usage_history() -> dict[str, Any] | None:
    bucket_seconds = max(60, int(config.BUCKET_SECONDS or 3600))
    hours = max(1, int(config.HISTORY_HOURS or 48))
    now_ts = int(time.time())
    bucket_count = max(1, (hours * 3600 + bucket_seconds - 1) // bucket_seconds)
    start_ts = (now_ts // bucket_seconds * bucket_seconds) - ((bucket_count - 1) * bucket_seconds)
    end_ts = start_ts + bucket_count * bucket_seconds
    recent_seconds = max(int(config.REALTIME_WINDOW or 300), bucket_seconds)
    recent_start = now_ts - recent_seconds

    customer_rows = _query_newapi_gpt_logs(start_ts, end_ts)
    source = "newapi_logs"

    points = _empty_history_points(start_ts, bucket_seconds, bucket_count)
    totals = {
        "requests": 0,
        "success": 0,
        "failed": 0,
        "tokens": 0,
        "recent_requests": 0,
        "recent_success": 0,
        "recent_failed": 0,
        "recent_tokens": 0,
    }

    for row in customer_rows:
        try:
            parsed = _parse_time(row.get("timestamp"))
        except (TypeError, ValueError, OSError):
            parsed = None
        if not parsed:
            continue
        ts = int(parsed.timestamp())
        if ts < start_ts or ts >= end_ts:
            continue

        failed = _is_failed(row.get("failed"))
        tokens = int(row.get("total_tokens") or 0)
        idx = (ts - start_ts) // bucket_seconds
        point = points[idx]
        point["requests_total"] = int(point["requests_total"] or 0) + 1
        point["requests_succeeded"] = int(point["requests_succeeded"] or 0) + (0 if failed else 1)
        point["tokens"] = int(point["tokens"] or 0) + tokens

        totals["requests"] += 1
        totals["success"] += 0 if failed else 1
        totals["failed"] += 1 if failed else 0
        totals["tokens"] += tokens
        if ts >= recent_start:
            totals["recent_requests"] += 1
            totals["recent_success"] += 0 if failed else 1
            totals["recent_failed"] += 1 if failed else 0
            totals["recent_tokens"] += tokens

    for point in points:
        total = int(point["requests_total"] or 0)
        success = int(point["requests_succeeded"] or 0)
        point["status"] = _status_from_success(total, success)
        point["success_rate"] = round(success / total * 100, 1) if total > 0 else None

    history_rate = round(totals["success"] / totals["requests"] * 100, 1) if totals["requests"] else None
    recent_rate = (
        round(totals["recent_success"] / totals["recent_requests"] * 100, 1)
        if totals["recent_requests"]
        else None
    )
    return {
        "hours": hours,
        "bucket_seconds": bucket_seconds,
        "recent_window_seconds": recent_seconds,
        "source": source,
        "components": [
            {
                "component_type": "gpt",
                "display_name": "GPT 客户请求",
                "points": points,
            }
        ],
        "summary": {
            "customer_requests": totals["requests"],
            "customer_success": totals["success"],
            "customer_failed": totals["failed"],
            "customer_success_rate": history_rate,
            "customer_tokens": totals["tokens"],
            "recent_customer_requests": totals["recent_requests"],
            "recent_customer_success": totals["recent_success"],
            "recent_customer_failed": totals["recent_failed"],
            "recent_customer_success_rate": recent_rate,
            "recent_customer_tokens": totals["recent_tokens"],
            "recent_window_seconds": recent_seconds,
        },
    }


def _query_usage_db(path: str) -> list[dict[str, Any]]:
    con = None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=config.GPT_TIMEOUT_SECONDS)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            select coalesce(plan_type, 'unknown') plan_type,
                   count(*) accounts,
                   sum(case when coalesce(disabled, 0)=0 and coalesce(is_deleted, 0)=0 then 1 else 0 end) enabled,
                   sum(coalesce(total_requests, 0)) req,
                   sum(coalesce(success_count, 0)) success,
                   sum(coalesce(failure_count, 0)) fail,
                   sum(coalesce(total_tokens, 0)) tokens,
                   max(last_used_at) last_used,
                   min(active_until) nearest_expiry
            from usage_identities
            where lower(coalesce("type", ''))='codex'
               or lower(coalesce(provider, ''))='codex'
               or lower(coalesce(auth_type_name, ''))='oauth'
            group by coalesce(plan_type, 'unknown')
            order by tokens desc
            """
        ).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        logger.warning("GPT usage db collect failed: %s", exc)
        return []
    finally:
        try:
            if con:
                con.close()
        except Exception:  # noqa: BLE001
            pass


def _newapi_mysql_conn():
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


def _query_newapi_gpt_logs(start_ts: int, end_ts: int) -> list[dict[str, Any]]:
    try:
        with _newapi_mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    select created_at timestamp,
                           0 failed,
                           coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0) total_tokens
                    from logs
                    where created_at >= %s
                      and created_at < %s
                      and type = 2
                      and (
                        lower(coalesce(model_name, '')) like 'gpt-%%'
                        or lower(coalesce(model_name, '')) like 'chatgpt%%'
                      )
                    order by created_at desc
                    limit 200000
                    """,
                    (start_ts, end_ts),
                )
                return [dict(row) for row in cur.fetchall()]
    except Exception as exc:  # noqa: BLE001
        logger.warning("NewAPI GPT customer logs collect failed: %s", exc)
        return []


def _query_cpa_usage_events(path: str) -> list[dict[str, Any]]:
    con = None
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=config.GPT_TIMEOUT_SECONDS)
        con.row_factory = sqlite3.Row
        columns = {str(row["name"]) for row in con.execute("pragma table_info(usage_events)").fetchall()}
        if not {"timestamp", "failed"}.issubset(columns):
            return []
        token_expr = "coalesce(total_tokens, 0)" if "total_tokens" in columns else "0"
        filters = []
        if "provider" in columns:
            filters.append("lower(coalesce(provider, ''))='codex'")
        if "model" in columns:
            filters.extend(
                [
                    "lower(coalesce(model, '')) like 'gpt-%'",
                    "lower(coalesce(model, '')) like 'chatgpt%'",
                ]
            )
        if "source" in columns:
            filters.append("lower(coalesce(source, '')) like '%gpt%'")
        where = " or ".join(filters) if filters else "1=1"
        rows = con.execute(
            f"""
            select timestamp,
                   failed,
                   {token_expr} total_tokens
            from usage_events
            where {where}
            order by timestamp desc
            limit 200000
            """
        ).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        logger.warning("GPT customer usage history collect failed: %s", exc)
        return []
    finally:
        try:
            if con:
                con.close()
        except Exception:  # noqa: BLE001
            pass


def _headers_from_plan(source: dict[str, Any], token: str) -> dict[str, str]:
    headers = source.get("headers") if isinstance(source.get("headers"), dict) else {}
    out = {str(k): str(v) for k, v in headers.items()}
    api_key = str(source.get("api_key") or source.get("bearer") or "").strip()
    if api_key and "authorization" not in {k.lower(): v for k, v in out.items()}:
        out["authorization"] = f"Bearer {api_key}"
    elif token and bool(source.get("send_access_token_to_usage")):
        out["authorization"] = f"Bearer {token}"
    return out


def _http_error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        body = ""
    return f"HTTP {exc.code}{': ' + _summarize_body(body) if body else ''}"


def _set_error(item: dict[str, Any], error_type: str, detail: str) -> None:
    label, action = ERROR_MESSAGES.get(error_type, ("采集失败", "查看日志"))
    item["error_type"] = error_type
    item["error_detail"] = detail
    item["error_action"] = action
    item["error"] = f"{label}: {detail}"


def _record_result(tag: str, ok: bool) -> int:
    if ok:
        _failure_counts[tag] = 0
    else:
        _failure_counts[tag] = _failure_counts.get(tag, 0) + 1
    return _failure_counts[tag]


def _mock_account(idx: int) -> dict[str, Any]:
    total = 100
    used = random.randint(5, 88)
    return {
        "tag": f"gpt-{idx}",
        "name": f"GPT {chr(64 + idx)}",
        "ok": True,
        "error": None,
        "error_type": None,
        "error_detail": None,
        "error_action": None,
        "consecutive_failures": 0,
        "updated_at": _iso_now(),
        "latency_ms": random.randint(150, 900),
        "email": f"gpt-{idx}@example.com",
        "plan_type": random.choice(["plus", "pro", "team"]),
        "usage": {
            "title": "GPT",
            "quotas": [
                {
                    "title": "本周额度",
                    "total": total,
                    "used": used,
                    "remaining": total - used,
                    "percent": used,
                    "time_range": "05/25 00:00 - 06/01 00:00(UTC+8)",
                    "reset_text": "32 小时后重置",
                }
            ],
        },
        "package": {
            "package_name": "pro",
            "expiration_text": "2026-06-30 23:59:59(UTC+8)",
            "days_remaining": 31,
        },
    }


def collect(force: bool = False) -> dict[str, Any]:
    global _cache_at, _cache_payload

    now = time.time()
    with _lock():
        if (
            not force
            and _cache_payload is not None
            and now - _cache_at < config.GPT_REFRESH_SECONDS
        ):
            cached = dict(_cache_payload)
            cached["cache"] = {"hit": True, "age_seconds": round(now - _cache_at)}
            return cached

    if config.MOCK_MODE:
        accounts = [_mock_account(1), _mock_account(2)]
        history = None
    else:
        plans = config.get_gpt_token_plans()
        accounts = [_collect_account(plan) for plan in plans] if plans else _collect_usage_db()
        history = _collect_customer_usage_history()

    summary = _build_summary(accounts)
    if history and isinstance(history.get("summary"), dict):
        summary.update(history["summary"])

    payload = {
        "enabled": bool(accounts),
        "refresh_seconds": config.GPT_REFRESH_SECONDS,
        "updated_at": _iso_now(),
        "accounts": accounts,
        "history": history,
        "summary": summary,
        "cache": {"hit": False, "age_seconds": 0},
    }

    with _lock():
        _cache_payload = payload
        _cache_at = time.time()
    return payload


def _build_summary(accounts: list[dict[str, Any]]) -> dict[str, Any]:
    ok_accounts = [a for a in accounts if a.get("ok")]
    error_counts: dict[str, int] = {}
    for account in accounts:
        error_type = account.get("error_type")
        if error_type:
            error_counts[error_type] = error_counts.get(error_type, 0) + 1

    quota_totals: dict[str, dict[str, int | float | None]] = {}
    for account in ok_accounts:
        for quota in ((account.get("usage") or {}).get("quotas") or []):
            key = str(quota.get("title") or "额度")
            bucket = quota_totals.setdefault(key, {"total": 0, "used": 0, "remaining": 0, "percent": None})
            bucket["total"] = int(bucket["total"] or 0) + int(quota.get("total") or 0)
            bucket["used"] = int(bucket["used"] or 0) + int(quota.get("used") or 0)
            bucket["remaining"] = int(bucket["remaining"] or 0) + int(quota.get("remaining") or 0)
    for bucket in quota_totals.values():
        total = int(bucket["total"] or 0)
        used = int(bucket["used"] or 0)
        bucket["percent"] = round(used / total * 100) if total > 0 else None

    primary = next(iter(quota_totals.values()), {"total": 0, "used": 0, "remaining": 0, "percent": None})
    return {
        "ok": len(ok_accounts),
        "total": len(accounts),
        "degraded": len(accounts) - len(ok_accounts),
        "error_counts": error_counts,
        "primary": primary,
        "quotas": quota_totals,
    }
