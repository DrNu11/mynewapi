"""
DeepSeek 防并发一键开关 - Admin API

通过 NewAPI 的 /api/option PUT 端点动态切换 ModelRequestRateLimitEnabled。
比直接改 mysql + restart 更优雅(NewAPI 内部会同步更新内存 state)。
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import urllib.request
import urllib.error
import json

import pymysql
import pymysql.cursors

import config

logger = logging.getLogger("throttle-admin")

# NewAPI 容器内网地址(docker network 互通)
NEWAPI_INTERNAL_URL = os.getenv("NEWAPI_INTERNAL_URL", "http://newapi-prod-new-api-1:3000")


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


def _get_admin_token() -> Optional[str]:
    """从 mysql users 表拿 admin (id=1) 的 access_token"""
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT access_token FROM users WHERE id=1 LIMIT 1")
                row = cur.fetchone()
                if row and row.get("access_token"):
                    return row["access_token"]
    except Exception as e:  # noqa: BLE001
        logger.warning("get admin token failed: %s", e)
    return None


def get_throttle_status() -> dict:
    """读 mysql options 表,返回当前限流配置状态。"""
    try:
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT `key`, value FROM options WHERE `key` LIKE %s",
                    ("ModelRequestRateLimit%",),
                )
                rows = cur.fetchall()
        opts = {r["key"]: r["value"] for r in rows}

        enabled = opts.get("ModelRequestRateLimitEnabled", "false").lower() == "true"
        duration_min = int(opts.get("ModelRequestRateLimitDurationMinutes") or 10)

        # de-throttled group 的限流参数(DeepSeek 客户专用)
        try:
            groups = json.loads(opts.get("ModelRequestRateLimitGroup") or "{}")
        except json.JSONDecodeError:
            groups = {}
        de_throttled = groups.get("de-throttled") or [0, 0]

        # 统计 de-throttled group 里有多少 token (反映被限流的 DeepSeek 客户数)
        try:
            with _mysql_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) AS c FROM tokens WHERE `group`=%s",
                        ("de-throttled",),
                    )
                    capped_count = cur.fetchone()["c"]
        except Exception:  # noqa: BLE001
            capped_count = 0

        return {
            "enabled": enabled,
            "duration_minutes": duration_min,
            "de_throttled_total": de_throttled[0] if len(de_throttled) > 0 else 0,
            "de_throttled_success": de_throttled[1] if len(de_throttled) > 1 else 0,
            "capped_token_count": capped_count,
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("get_throttle_status failed: %s", e)
        return {"enabled": False, "error": str(e)}


def set_throttle_enabled(enabled: bool) -> dict:
    """通过 NewAPI admin API 动态切换 ModelRequestRateLimitEnabled。

    使用 NewAPI 的 /api/option PUT 端点,这样会:
      1. 更新 mysql options 表
      2. 同时更新 NewAPI 进程内的 setting bool(免重启)
    """
    admin_token = _get_admin_token()
    if not admin_token:
        return {"ok": False, "error": "无法获取 admin token"}

    body = {
        "key": "ModelRequestRateLimitEnabled",
        "value": "true" if enabled else "false",
    }
    try:
        req = urllib.request.Request(
            url=f"{NEWAPI_INTERNAL_URL}/api/option/",
            method="PUT",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {admin_token}",
                "New-Api-User": "1",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read().decode("utf-8")
            return {"ok": True, "newapi_response": data, "enabled": enabled}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore") if e.fp else ""
        return {"ok": False, "error": f"NewAPI HTTP {e.code}: {body}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"NewAPI 请求失败: {e}"}
