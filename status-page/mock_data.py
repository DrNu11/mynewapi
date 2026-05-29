"""
本地无 MySQL / 无 docker 时使用的 mock 数据。
"""
from __future__ import annotations

import random
import time

import config


def _rand_status() -> str:
    return random.choices(
        ["operational", "operational", "operational", "degraded", "partial_outage", "no_data"],
        weights=[60, 15, 10, 8, 5, 2],
    )[0]


def mock_history() -> dict:
    now = int(time.time())
    bucket_sec = config.BUCKET_SECONDS
    points = []
    current_start = (now // bucket_sec) * bucket_sec
    for i in range(config.HISTORY_HOURS, -1, -1):
        bs = current_start - i * bucket_sec
        be = bs + bucket_sec
        status = _rand_status()
        total = random.randint(800, 5000) if status != "no_data" else 0
        succ_rate = {
            "operational": 99.5,
            "degraded": 96.0,
            "partial_outage": 85.0,
            "major_outage": 50.0,
            "no_data": 0,
        }[status]
        points.append(
            {
                "bucket_start": bs,
                "bucket_end": be,
                "status": status,
                "requests_total": total,
                "requests_succeeded": int(total * succ_rate / 100),
                "avg_latency_ms": random.randint(1500, 8000) if status != "no_data" else 0,
            }
        )
    return {
        "hours": config.HISTORY_HOURS,
        "bucket_seconds": bucket_sec,
        "components": [
            {
                "component_type": "gateway",
                "display_name": "Gateway",
                "points": points,
            }
        ],
    }


def mock_system() -> dict:
    return {
        "cpu_percent": round(random.uniform(5, 75), 1),
        "memory": {
            "used_mb": random.randint(1200, 6000),
            "total_mb": 8192,
            "percent": round(random.uniform(20, 80), 1),
        },
        "disk": {
            "used_gb": 28.4,
            "total_gb": 80.0,
            "percent": 35.5,
        },
        "network": {
            "rx_speed_bps": random.randint(1_000_000, 50_000_000),
            "tx_speed_bps": random.randint(500_000, 20_000_000),
        },
        "load": [round(random.uniform(0.1, 2.0), 2) for _ in range(3)],
        "uptime_seconds": random.randint(86400 * 3, 86400 * 30),
    }


def _mock_gateway_data(gw_cfg: dict) -> dict:
    """根据 gateway 类型生成更贴近真实的数据。"""
    tag = gw_cfg.get("tag", "")

    if tag == "newapi":
        routes_def = [
            "/v1/chat/completions",
            "/v1/responses",
            "/anthropic/v1/messages",
            "/v1/audio/speech",
        ]
        node_count = 7
        node_prefix = "ch"
        uptime = random.randint(86400 * 2, 86400 * 15)
    elif tag == "cpa":
        routes_def = ["/v1/responses", "/v1/chat/completions", "/v0/management/usage"]
        node_count = 100
        node_prefix = "token"
        uptime = random.randint(3600 * 4, 86400 * 5)
    else:
        # cards 或其他 health-only 网关
        return {
            "uptime_seconds": random.randint(86400, 86400 * 10),
            "nodes": [
                {
                    "node": gw_cfg.get("name", "service"),
                    "available": True,
                    "client_id": tag,
                    "attempts": {"total": 0, "success_rate": 100.0},
                    "avg_first_byte_latency_ms": random.randint(20, 200),
                }
            ],
            "requests": {"total": 0, "success_rate": 100.0},
            "latency": {"avg_ms": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0},
            "tokens": {"total_tokens": 0},
            "routes": {},
            "status_codes": {},
        }

    nodes = []
    for i in range(node_count):
        total = random.randint(100, 100_000)
        rate = round(random.uniform(85, 99.9), 1)
        nodes.append(
            {
                "node": f"{node_prefix}-{i:03d}-{random.choice(['mimo', 'longcat', 'siliconflow', 'volcano'])}-{random.randint(100, 999)}",
                "available": rate >= 90.0,
                "client_id": str(i),
                "attempts": {"total": total, "success_rate": rate},
                "avg_first_byte_latency_ms": random.randint(800, 6000),
            }
        )

    routes_out = {}
    total_reqs = 0
    total_tokens = 0
    for r in routes_def:
        t = random.randint(10_000, 5_000_000)
        tok = t * random.randint(2000, 30_000) if tag == "newapi" else 0
        total_reqs += t
        total_tokens += tok
        routes_out[r] = {
            "requests": {"total": t, "success_rate": round(random.uniform(85, 99), 1)},
            "tokens": {"total_tokens": tok},
            "avg_latency_ms": random.randint(2000, 32000),
            "streaming_requests": int(t * random.uniform(0.4, 0.95)),
            "non_streaming_requests": int(t * random.uniform(0.05, 0.6)),
        }

    return {
        "uptime_seconds": uptime,
        "nodes": nodes,
        "requests": {"total": total_reqs, "success_rate": round(random.uniform(88, 98), 1)},
        "latency": {
            "avg_ms": random.randint(5000, 18000),
            "p50_ms": random.randint(2000, 8000),
            "p95_ms": random.randint(20000, 60000),
            "p99_ms": random.randint(60000, 150000),
        },
        "tokens": {"total_tokens": total_tokens},
        "routes": routes_out,
        "status_codes": {
            "200": int(total_reqs * 0.91),
            "400": int(total_reqs * 0.012),
            "401": int(total_reqs * 0.001),
            "404": int(total_reqs * 0.004),
            "429": int(total_reqs * 0.0005),
            "500": int(total_reqs * 0.0002),
            "502": int(total_reqs * 0.007),
            "504": int(total_reqs * 0.052),
        },
    }


def mock_gateway_for(gw_cfg: dict) -> dict:
    return _mock_gateway_data(gw_cfg)
