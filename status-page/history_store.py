"""
48h 历史桶 (uptime bar) 持久化到 SQLite。

策略:
- 启动时,从 NewAPI logs 回填过去 HISTORY_HOURS 小时的所有桶(每桶 1h)。
- 之后每 REFRESH_SECONDS 秒,只刷新"当前小时桶"(因为旧桶已固定)。
- 前端从 /api/stats 拿到 history.components[].points = 当前所有桶。
"""
from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

import config
import gateway_metrics

# 兼容:旧 API 函数名 gateway_metrics.aggregate_bucket → 新名 aggregate_mysql_bucket
if not hasattr(gateway_metrics, "aggregate_bucket"):
    gateway_metrics.aggregate_bucket = gateway_metrics.aggregate_mysql_bucket  # type: ignore[attr-defined]


def _conn() -> sqlite3.Connection:
    Path(config.HISTORY_DB).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(config.HISTORY_DB, timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS history_buckets (
            bucket_start INTEGER PRIMARY KEY,
            bucket_end INTEGER NOT NULL,
            status TEXT NOT NULL,
            requests_total INTEGER NOT NULL DEFAULT 0,
            requests_succeeded INTEGER NOT NULL DEFAULT 0,
            avg_latency_ms INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        )
        """
    )
    return c


def upsert_bucket(bucket: dict) -> None:
    now = int(time.time())
    with _conn() as c:
        c.execute(
            """
            INSERT INTO history_buckets
              (bucket_start, bucket_end, status, requests_total, requests_succeeded, avg_latency_ms, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bucket_start) DO UPDATE SET
              bucket_end = excluded.bucket_end,
              status = excluded.status,
              requests_total = excluded.requests_total,
              requests_succeeded = excluded.requests_succeeded,
              avg_latency_ms = excluded.avg_latency_ms,
              updated_at = excluded.updated_at
            """,
            (
                bucket["bucket_start"],
                bucket["bucket_end"],
                bucket["status"],
                bucket["requests_total"],
                bucket["requests_succeeded"],
                bucket["avg_latency_ms"],
                now,
            ),
        )


def backfill_if_empty() -> None:
    """启动时如果库里桶不够,把过去 HISTORY_HOURS 小时全部回填。"""
    now = int(time.time())
    bucket_sec = config.BUCKET_SECONDS
    # 当前桶起点对齐到桶宽
    current_start = (now // bucket_sec) * bucket_sec
    earliest = current_start - bucket_sec * (config.HISTORY_HOURS * 3600 // bucket_sec)

    with _conn() as c:
        cur = c.execute(
            "SELECT COUNT(*) AS cnt FROM history_buckets WHERE bucket_start >= ?",
            (earliest,),
        )
        existing = cur.fetchone()["cnt"]

    expected = (config.HISTORY_HOURS * 3600 // bucket_sec)
    if existing >= expected - 1:
        return  # 已经有数据,不重复回填(只允许差 1 桶)

    bs = earliest
    while bs <= current_start:
        be = bs + bucket_sec
        try:
            bucket = gateway_metrics.aggregate_bucket(bs, be)
            upsert_bucket(bucket)
        except Exception as e:  # noqa: BLE001
            # 回填失败不影响主流程,留个空桶占位
            upsert_bucket(
                {
                    "bucket_start": bs,
                    "bucket_end": be,
                    "status": "no_data",
                    "requests_total": 0,
                    "requests_succeeded": 0,
                    "avg_latency_ms": 0,
                }
            )
        bs = be


def refresh_current() -> None:
    """刷新当前桶(以及上一桶,防止跨边界时遗漏)。"""
    now = int(time.time())
    bucket_sec = config.BUCKET_SECONDS
    current_start = (now // bucket_sec) * bucket_sec
    prev_start = current_start - bucket_sec

    for bs in (prev_start, current_start):
        be = bs + bucket_sec
        try:
            bucket = gateway_metrics.aggregate_bucket(bs, be)
            upsert_bucket(bucket)
        except Exception:
            pass


def fetch_recent_points() -> list[dict]:
    now = int(time.time())
    bucket_sec = config.BUCKET_SECONDS
    earliest = now - config.HISTORY_HOURS * 3600
    with _conn() as c:
        rows = c.execute(
            """
            SELECT bucket_start, bucket_end, status, requests_total, requests_succeeded, avg_latency_ms
            FROM history_buckets
            WHERE bucket_start >= ?
            ORDER BY bucket_start ASC
            """,
            (earliest,),
        ).fetchall()
    return [
        {
            "bucket_start": r["bucket_start"],
            "bucket_end": r["bucket_end"],
            "status": r["status"],
            "requests_total": r["requests_total"],
            "requests_succeeded": r["requests_succeeded"],
            "avg_latency_ms": r["avg_latency_ms"],
        }
        for r in rows
    ]


def build_history_payload() -> dict:
    return {
        "hours": config.HISTORY_HOURS,
        "bucket_seconds": config.BUCKET_SECONDS,
        "components": [
            {
                "component_type": "gateway",
                "display_name": "Gateway",
                "points": fetch_recent_points(),
            }
        ],
    }
