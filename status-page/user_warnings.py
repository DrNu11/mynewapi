"""
Create user-facing warnings in NewAPI when backend alerts repeat.

The status page is the component that sees alert-email history, so it owns the
"third email escalates to customer prompt" decision and writes a small record
into NewAPI's user_warnings table.
"""
from __future__ import annotations

import hashlib
import logging
import time
from typing import Any

import pymysql
import pymysql.cursors

import config

logger = logging.getLogger("status-page.user-warnings")


def maybe_create_from_alert(alert: dict[str, Any], state_entry: dict[str, Any]) -> bool:
    if not config.ALERT_USER_WARNING_ENABLED:
        return False
    if not str(alert.get("key") or "").startswith("abuse:"):
        return False
    if int(state_entry.get("sent_count") or 0) < config.ALERT_USER_WARNING_EMAIL_THRESHOLD:
        return False
    if state_entry.get("user_warning_triggered_at"):
        return False

    user_id = _alert_user_id(alert)
    if user_id <= 0:
        return False

    now = int(time.time())
    expires_at = now + config.ALERT_USER_WARNING_EXPIRE_HOURS * 3600
    source_key = _source_key(alert)
    title, message = _warning_text(alert)

    try:
        _upsert_warning(
            user_id=user_id,
            source_key=source_key,
            title=title,
            message=message,
            level=str(alert.get("level") or "warning"),
            now=now,
            expires_at=expires_at,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("create user warning failed for %s: %s", alert.get("key"), exc)
        state_entry["user_warning_error"] = str(exc)
        return False

    state_entry["user_warning_triggered_at"] = now
    state_entry["user_warning_source_key"] = source_key
    return True


def _alert_user_id(alert: dict[str, Any]) -> int:
    for key in ("user_id", "top_user_id"):
        try:
            value = int(alert.get(key) or 0)
        except (TypeError, ValueError):
            value = 0
        if value > 0:
            return value
    return 0


def _source_key(alert: dict[str, Any]) -> str:
    digest = hashlib.sha256(str(alert.get("key") or "").encode("utf-8")).hexdigest()[:24]
    return f"status-page:{digest}"


def _warning_text(alert: dict[str, Any]) -> tuple[str, str]:
    kind = str(alert.get("kind") or "")
    token_name = str(alert.get("token_name") or alert.get("top_token") or "").strip()
    reason = str(alert.get("reason") or "").strip()
    ip = str(alert.get("ip") or alert.get("top_ip") or "").strip()
    requests = str(alert.get("request_count") or alert.get("requests") or "").strip()
    window = str(alert.get("window_seconds") or config.REALTIME_WINDOW)

    if kind == "ip_abuse":
        title = "检测到 IP 请求频率异常"
        message = (
            f"系统检测到你的访问 IP {ip or '-'} 在 {window} 秒内请求频率偏高"
            f"{f'({requests} 次)' if requests else ''}。请降低并发、检查脚本重试逻辑，"
            "避免触发风控或影响账号稳定。如非本人操作，请尽快重置相关 API Key。"
        )
        return title, message

    title = "检测到 API Key 异常使用"
    subject = f"API Key「{token_name}」" if token_name else "你的 API Key"
    message = (
        f"系统检测到{subject}在短时间内出现异常使用"
        f"{f'：{reason}' if reason else ''}。"
        f"{f'最近 {window} 秒请求约 {requests} 次。' if requests else ''}"
        "请检查是否存在多人共享、脚本并发过高或密钥泄露；如非本人操作，请立即重置密钥或联系管理员。"
    )
    return title, message


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
        write_timeout=10,
        autocommit=True,
    )


def _upsert_warning(
    *,
    user_id: int,
    source_key: str,
    title: str,
    message: str,
    level: str,
    now: int,
    expires_at: int,
) -> None:
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS user_warnings (
                    id bigint unsigned NOT NULL AUTO_INCREMENT,
                    user_id bigint NOT NULL,
                    source varchar(64) NOT NULL DEFAULT 'status-page',
                    source_key varchar(191) NOT NULL,
                    level varchar(32) NOT NULL DEFAULT 'warning',
                    title varchar(255) NOT NULL DEFAULT '',
                    message text NOT NULL,
                    created_at bigint NOT NULL DEFAULT 0,
                    updated_at bigint NOT NULL DEFAULT 0,
                    expires_at bigint NOT NULL DEFAULT 0,
                    acknowledged_at bigint NOT NULL DEFAULT 0,
                    PRIMARY KEY (id),
                    UNIQUE KEY idx_user_warning_source (user_id, source_key),
                    KEY idx_user_warnings_user_id (user_id),
                    KEY idx_user_warnings_expires_at (expires_at),
                    KEY idx_user_warnings_acknowledged_at (acknowledged_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                """
            )
            cur.execute(
                """
                INSERT INTO user_warnings
                    (user_id, source, source_key, level, title, message, created_at, updated_at, expires_at, acknowledged_at)
                VALUES
                    (%s, 'status-page', %s, %s, %s, %s, %s, %s, %s, 0)
                ON DUPLICATE KEY UPDATE
                    level = VALUES(level),
                    title = VALUES(title),
                    message = VALUES(message),
                    updated_at = VALUES(updated_at),
                    expires_at = VALUES(expires_at),
                    acknowledged_at = 0
                """,
                (user_id, source_key, level, title, message, now, now, expires_at),
            )
