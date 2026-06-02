"""
Email alerting for status-page.

Alerts are deliberately edge-triggered with a cooldown so a persistent outage
does not spam the mailbox every refresh cycle.
"""
from __future__ import annotations

import json
import logging
import smtplib
import ssl
import time
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import config
import gpt_monitor
import minimax_monitor
import user_warnings

logger = logging.getLogger("status-page.alerts")


def enabled() -> bool:
    return bool(
        config.ALERT_EMAIL_TO
        and config.ALERT_SMTP_HOST
        and config.ALERT_SMTP_USER
        and config.ALERT_SMTP_PASSWORD
    )


def evaluate_and_send(stats_payload: list[dict[str, Any]]) -> dict[str, Any]:
    if not enabled():
        return {"enabled": False, "sent": 0, "alerts": []}

    alerts = _build_alerts(stats_payload)
    state = _load_state()
    state_changed = _migrate_legacy_alert_keys(alerts, state)
    state_changed = _migrate_active_alert_state(alerts, state) or state_changed
    state_changed = _mark_resolved_active_alerts(alerts, state) or state_changed
    due = [alert for alert in alerts if _should_send(alert, state)]
    sent = 0
    for alert in due:
        try:
            _send_email(alert)
        except Exception as exc:  # noqa: BLE001
            logger.warning("send alert email failed: %s", exc)
            continue
        last = state.get(alert["key"]) or {}
        if not isinstance(last, dict):
            last = {}
        entry = {
            **last,
            "last_sent_at": int(time.time()),
            "sent_count": int(last.get("sent_count") or 0) + 1,
            "level": alert["level"],
            "title": alert["title"],
        }
        if alert.get("dedupe") == "active":
            entry.update(
                {
                    "dedupe": "active",
                    "active": True,
                    "fingerprint": alert.get("fingerprint") or "",
                }
            )
        _record_max_email_group_send(alert, state)
        user_warnings.maybe_create_from_alert(alert, entry)
        state[alert["key"]] = entry
        sent += 1
    if sent or state_changed:
        _save_state(state)
    return {"enabled": True, "sent": sent, "alerts": alerts}


def send_test_email() -> None:
    if not enabled():
        raise RuntimeError("email alert is not configured")
    _send_email(
        {
            "key": "test",
            "level": "info",
            "title": "Nassa Status 告警测试",
            "body": "这是一封 status-page 邮件告警测试。收到说明 SMTP 配置可用。",
        }
    )


def _build_alerts(stats_payload: list[dict[str, Any]]) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []
    alerts.extend(_minimax_alerts())
    alerts.extend(_gpt_alerts())
    alerts.extend(_gateway_alerts(stats_payload))
    return alerts


def _minimax_alerts() -> list[dict[str, str]]:
    payload = minimax_monitor.collect()
    accounts = payload.get("accounts") or []
    alerts: list[dict[str, str]] = []

    for account in accounts:
        tag = account.get("tag") or account.get("name") or "minimax"
        name = account.get("name") or tag
        if not account.get("ok"):
            alerts.append(
                {
                    "key": f"minimax:{tag}:down",
                    "level": "critical",
                    "title": f"MiniMax 账号异常: {name}",
                    "body": (
                        f"账号: {name}\n"
                        f"状态: {account.get('error') or '采集失败'}\n"
                        f"连续失败: {account.get('consecutive_failures') or 0} 次\n"
                        f"建议: {account.get('error_action') or '检查 Cookie / 登录态'}"
                    ),
                }
            )
            continue

        text_generation = account.get("text_generation") or {}
        weekly = text_generation.get("weekly") or {}
        five_hour = text_generation.get("five_hour") or {}
        weekly_percent = int(weekly.get("percent") or 0)
        five_hour_percent = int(five_hour.get("percent") or 0)
        if weekly_percent >= config.ALERT_MINIMAX_WEEKLY_WARN_PERCENT:
            bucket = _quota_bucket(weekly_percent, config.ALERT_MINIMAX_WEEKLY_WARN_PERCENT)
            alerts.append(
                {
                    "key": f"minimax:{tag}:weekly:{config.ALERT_MINIMAX_WEEKLY_WARN_PERCENT}",
                    "level": "warning" if bucket == "warn" else "critical",
                    "title": f"MiniMax 本周额度偏高: {name} {weekly_percent}%",
                    "body": _quota_body(name, "本周额度", weekly),
                    "dedupe": "active",
                    "fingerprint": _quota_fingerprint("weekly", weekly, bucket),
                }
            )
        if five_hour_percent >= config.ALERT_MINIMAX_FIVE_HOUR_WARN_PERCENT:
            bucket = _quota_bucket(five_hour_percent, config.ALERT_MINIMAX_FIVE_HOUR_WARN_PERCENT)
            alerts.append(
                {
                    "key": f"minimax:{tag}:five_hour:{config.ALERT_MINIMAX_FIVE_HOUR_WARN_PERCENT}",
                    "level": "warning" if bucket == "warn" else "critical",
                    "title": f"MiniMax 5小时额度偏高: {name} {five_hour_percent}%",
                    "body": _quota_body(name, "5小时额度", five_hour),
                    "dedupe": "active",
                    "fingerprint": _quota_fingerprint("five_hour", five_hour, bucket),
                }
            )
    return alerts


def _gpt_alerts() -> list[dict[str, str]]:
    payload = gpt_monitor.collect()
    summary = payload.get("summary") or {}
    alerts: list[dict[str, str]] = []

    total = int(summary.get("recent_customer_requests") or 0)
    success = int(summary.get("recent_customer_success") or 0)
    failed = int(summary.get("recent_customer_failed") or 0)
    tokens = int(summary.get("recent_customer_tokens") or 0)
    success_rate = summary.get("recent_customer_success_rate")

    if total < config.ALERT_MIN_REQUESTS_FOR_RATE or success_rate is None:
        return alerts

    success_rate = float(success_rate)
    if success_rate >= config.ALERT_GPT_SUCCESS_RATE_WARN:
        return alerts

    window = int(summary.get("recent_window_seconds") or (payload.get("history") or {}).get("recent_window_seconds") or config.REALTIME_WINDOW)
    bucket = "critical" if success_rate < 50 else f"warn-{config.ALERT_GPT_SUCCESS_RATE_WARN}"
    alerts.append(
        {
            "key": f"gpt:customer_success_rate:{config.ALERT_GPT_SUCCESS_RATE_WARN}",
            "level": "warning" if success_rate >= 50 else "critical",
            "title": f"GPT 客户请求成功率低于 {config.ALERT_GPT_SUCCESS_RATE_WARN}%: {success_rate:.1f}%",
            "body": (
                "指标: GPT 客户请求成功率\n"
                f"窗口: 最近 {round(window / 60)} 分钟\n"
                f"成功率: {success_rate:.1f}%\n"
                f"成功/总请求: {success} / {total}\n"
                f"失败: {failed}\n"
                f"Token: {tokens:,}\n"
                f"阈值: {config.ALERT_GPT_SUCCESS_RATE_WARN}%"
            ),
            "dedupe": "active",
            "fingerprint": json.dumps(
                {"metric": "customer_success_rate", "bucket": bucket, "total": total},
                ensure_ascii=False,
                sort_keys=True,
            ),
        }
    )
    return alerts


def _quota_bucket(percent: int, warn_percent: int) -> str:
    if percent >= 99:
        return "exhausted"
    if percent >= 95:
        return "critical"
    return f"warn-{warn_percent}"


def _quota_fingerprint(metric: str, quota: dict[str, Any], bucket: str) -> str:
    return json.dumps(
        {
            "metric": metric,
            "bucket": bucket,
            "total": quota.get("total"),
            "time_range": quota.get("time_range"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )


def _quota_body(name: str, label: str, quota: dict[str, Any]) -> str:
    return (
        f"账号: {name}\n"
        f"指标: {label}\n"
        f"已用: {quota.get('used')} / {quota.get('total')} ({quota.get('percent')}%)\n"
        f"剩余: {quota.get('remaining')}\n"
        f"窗口: {quota.get('time_range') or '-'}\n"
        f"重置: {quota.get('reset_text') or '-'}"
    )


def _gateway_alerts(stats_payload: list[dict[str, Any]]) -> list[dict[str, str]]:
    alerts: list[dict[str, str]] = []
    for gateway in stats_payload:
        tag = gateway.get("tag") or "gateway"
        name = gateway.get("name") or tag
        if gateway.get("error"):
            alerts.append(
                {
                    "key": f"gateway:{tag}:collect_failed",
                    "level": "critical",
                    "title": f"API 采集异常: {name}",
                    "body": str(gateway.get("error")),
                }
            )
            continue
        data = gateway.get("data") or {}
        req = data.get("requests") or {}
        total = int(req.get("total") or 0)
        success_rate = float(req.get("success_rate") or 100)
        if total >= config.ALERT_MIN_REQUESTS_FOR_RATE and success_rate < config.ALERT_SUCCESS_RATE_WARN:
            alerts.append(
                {
                    "key": f"gateway:{tag}:success_rate",
                    "level": "warning" if success_rate >= 90 else "critical",
                    "title": f"API 成功率下降: {name} {success_rate:.1f}%",
                    "body": f"{name} 最近窗口请求 {total} 次,成功率 {success_rate:.1f}%。",
                }
            )

        for alert in data.get("abuse_alerts") or []:
            token_name = alert.get("token_name") or "(no-name)"
            user_id = int(alert.get("user_id") or 0)
            token_id = int(alert.get("token_id") or 0)
            abuse_key = (
                f"abuse:{tag}:user:{user_id}:token:{token_id or token_name}:{alert.get('reason')}"
                if user_id
                else f"abuse:{tag}:{token_name}:{alert.get('reason')}"
            )
            legacy_key = f"abuse:{tag}:{token_name}:{alert.get('reason')}"
            alerts.append(
                {
                    "key": abuse_key,
                    "legacy_key": legacy_key,
                    "kind": "token_abuse",
                    "user_id": str(user_id),
                    "username": str(alert.get("username") or ""),
                    "token_id": str(token_id),
                    "token_name": str(token_name),
                    "reason": str(alert.get("reason") or ""),
                    "request_count": str(alert.get("request_count") or ""),
                    "top_ip": str(alert.get("top_ip") or ""),
                    "window_seconds": str(data.get("window_seconds", config.REALTIME_WINDOW)),
                    "max_emails": str(config.ALERT_ABUSE_MAX_EMAILS),
                    "max_email_group": f"abuse:user:{user_id}" if user_id else abuse_key,
                    "level": "warning",
                    "title": f"疑似异常使用: {token_name}",
                    "body": (
                        f"网关: {name}\n"
                        f"原因: {alert.get('reason')}\n"
                        f"请求数: {alert.get('request_count')} / {data.get('window_seconds', config.REALTIME_WINDOW)}s\n"
                        f"IP 数: {alert.get('ip_count')}\n"
                        f"Top IP: {alert.get('top_ip')}\n"
                        f"IP 明细: {json.dumps(alert.get('ips') or [], ensure_ascii=False)}"
                    ),
                }
            )

        suspicious_ips = [ip for ip in data.get("top_ips") or [] if ip.get("suspicious")]
        for ip in suspicious_ips[:3]:
            user_id = int(ip.get("top_user_id") or 0)
            token_id = int(ip.get("top_token_id") or 0)
            abuse_key = (
                f"abuse:{tag}:user:{user_id}:ip:{ip.get('ip')}"
                if user_id
                else f"abuse:{tag}:ip:{ip.get('ip')}"
            )
            legacy_key = f"abuse:{tag}:ip:{ip.get('ip')}"
            alerts.append(
                {
                    "key": abuse_key,
                    "legacy_key": legacy_key,
                    "kind": "ip_abuse",
                    "user_id": str(user_id),
                    "username": str(ip.get("top_username") or ""),
                    "token_id": str(token_id),
                    "token_name": str(ip.get("top_token") or ""),
                    "ip": str(ip.get("ip") or ""),
                    "requests": str(ip.get("requests") or ""),
                    "window_seconds": str(data.get("window_seconds", config.REALTIME_WINDOW)),
                    "max_emails": str(config.ALERT_ABUSE_MAX_EMAILS),
                    "max_email_group": f"abuse:user:{user_id}" if user_id else abuse_key,
                    "level": "warning",
                    "title": f"单 IP 高频请求: {ip.get('ip')}",
                    "body": (
                        f"网关: {name}\n"
                        f"IP: {ip.get('ip')}\n"
                        f"请求数: {ip.get('requests')} / {data.get('window_seconds', config.REALTIME_WINDOW)}s\n"
                        f"Token: {ip.get('top_token')}\n"
                        f"消耗 tokens: {ip.get('tokens')}"
                    ),
                }
            )
    return alerts


def _should_send(alert: dict[str, str], state: dict[str, Any]) -> bool:
    last = state.get(alert["key"]) or {}
    max_emails = int(alert.get("max_emails") or 0)
    if max_emails > 0 and int(last.get("sent_count") or 0) >= max_emails:
        return False
    group_count = _max_email_group_sent_count(alert, state)
    if max_emails > 0 and group_count >= max_emails:
        return False
    if alert.get("dedupe") == "active":
        return not (
            bool(last.get("active"))
            and str(last.get("fingerprint") or "") == str(alert.get("fingerprint") or "")
        )
    last_sent_at = int(last.get("last_sent_at") or 0)
    return time.time() - last_sent_at >= config.ALERT_COOLDOWN_SECONDS


def _max_email_group_sent_count(alert: dict[str, str], state: dict[str, Any]) -> int:
    group = str(alert.get("max_email_group") or "")
    if not group:
        return 0
    groups = state.get("__max_email_groups__")
    if not isinstance(groups, dict):
        groups = {}
    item = groups.get(group)
    if isinstance(item, dict):
        count = int(item.get("sent_count") or 0)
    else:
        count = 0
    # Backfill the aggregate counter from older per-alert state so already-spammed
    # users are capped immediately after this deployment.
    user_prefix = group.replace("abuse:user:", "user:")
    legacy_total = 0
    for key, value in state.items():
        if key.startswith("__") or not isinstance(value, dict):
            continue
        if user_prefix and user_prefix in key:
            legacy_total += int(value.get("sent_count") or 0)
    return max(count, legacy_total)


def _record_max_email_group_send(alert: dict[str, str], state: dict[str, Any]) -> None:
    group = str(alert.get("max_email_group") or "")
    if not group:
        return
    groups = state.get("__max_email_groups__")
    if not isinstance(groups, dict):
        groups = {}
    item = groups.get(group)
    if not isinstance(item, dict):
        item = {"sent_count": _max_email_group_sent_count(alert, state)}
    item["sent_count"] = int(item.get("sent_count") or 0) + 1
    item["last_sent_at"] = int(time.time())
    item["title"] = alert.get("title") or ""
    groups[group] = item
    state["__max_email_groups__"] = groups


def _migrate_legacy_alert_keys(alerts: list[dict[str, Any]], state: dict[str, Any]) -> bool:
    changed = False
    for alert in alerts:
        legacy_key = alert.get("legacy_key")
        if not legacy_key or legacy_key == alert["key"] or legacy_key not in state:
            continue
        legacy = state.get(legacy_key)
        if not isinstance(legacy, dict):
            continue
        current = state.get(alert["key"]) if isinstance(state.get(alert["key"]), dict) else {}
        merged = {**legacy, **current}
        legacy_sent_count = int(legacy.get("sent_count") or 0)
        current_sent_count = int(current.get("sent_count") or 0)
        if legacy.get("last_sent_at") and legacy_sent_count == 0:
            legacy_sent_count = max(1, config.ALERT_USER_WARNING_EMAIL_THRESHOLD - 1)
        merged["sent_count"] = max(legacy_sent_count, current_sent_count)
        merged["last_sent_at"] = max(int(legacy.get("last_sent_at") or 0), int(current.get("last_sent_at") or 0))
        state[alert["key"]] = merged
        changed = True
    return changed


def _migrate_active_alert_state(alerts: list[dict[str, Any]], state: dict[str, Any]) -> bool:
    changed = False
    for alert in alerts:
        if alert.get("dedupe") != "active":
            continue
        last = state.get(alert["key"])
        if not isinstance(last, dict) or last.get("fingerprint"):
            continue
        last["dedupe"] = "active"
        last["active"] = True
        last["fingerprint"] = str(alert.get("fingerprint") or "")
        last["migrated_at"] = int(time.time())
        changed = True
    return changed


def _mark_resolved_active_alerts(alerts: list[dict[str, Any]], state: dict[str, Any]) -> bool:
    active_keys = {alert["key"] for alert in alerts if alert.get("dedupe") == "active"}
    changed = False
    for key, last in state.items():
        if not isinstance(last, dict):
            continue
        if last.get("dedupe") == "active" and last.get("active") and key not in active_keys:
            last["active"] = False
            last["resolved_at"] = int(time.time())
            changed = True
    return changed


def _send_email(alert: dict[str, str]) -> None:
    sender = config.ALERT_EMAIL_FROM or config.ALERT_SMTP_USER
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = config.ALERT_EMAIL_TO
    msg["Subject"] = f"[Nassa Status][{alert['level']}] {alert['title']}"
    msg.set_content(
        f"{alert['title']}\n\n{alert['body']}\n\n"
        f"时间: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}\n"
        "地址: https://status.nassaapi.xyz/"
    )

    recipients = [item.strip() for item in config.ALERT_EMAIL_TO.split(";") if item.strip()]
    if config.ALERT_SMTP_SSL:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(config.ALERT_SMTP_HOST, config.ALERT_SMTP_PORT, timeout=15, context=context) as smtp:
            smtp.login(config.ALERT_SMTP_USER, config.ALERT_SMTP_PASSWORD)
            smtp.send_message(msg, from_addr=sender, to_addrs=recipients)
        return

    with smtplib.SMTP(config.ALERT_SMTP_HOST, config.ALERT_SMTP_PORT, timeout=15) as smtp:
        if config.ALERT_SMTP_STARTTLS:
            smtp.starttls(context=ssl.create_default_context())
        smtp.login(config.ALERT_SMTP_USER, config.ALERT_SMTP_PASSWORD)
        smtp.send_message(msg, from_addr=sender, to_addrs=recipients)


def _load_state() -> dict[str, Any]:
    path = Path(config.ALERT_STATE_DB)
    try:
        return json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return {}


def _save_state(state: dict[str, Any]) -> None:
    path = Path(config.ALERT_STATE_DB)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
