"""
MiniMax Token Plan quota collector.

The frontend never receives MiniMax cookies. Configure accounts through
MINIMAX_TOKEN_PLANS_JSON and expose only normalized quota data.
"""
from __future__ import annotations

import json
import logging
import random
import socket
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import config

logger = logging.getLogger("status-page.minimax")

MINIMAX_API_ORIGIN = "https://www.minimaxi.com"
MINIMAX_PLATFORM_ORIGIN = "https://platform.minimaxi.com"
REMAINS_PATH = "/v1/api/openplatform/coding_plan/remains"
RESOURCE_PACKAGE_PATH = "/backend/account/resource_package?page_num=1&page_size=20"
CN_TZ = ZoneInfo("Asia/Shanghai")

_cache_lock = threading.Lock()
_cache_payload: dict[str, Any] | None = None
_cache_at = 0.0
_failure_lock = threading.Lock()
_failure_counts: dict[str, int] = {}


ERROR_MESSAGES = {
    "auth_expired": ("登录态失效", "重新复制该 MiniMax 账号的 Cookie 到 207 .env"),
    "rate_limited": ("MiniMax 限流", "保持 30s 以上刷新间隔,稍后自动恢复"),
    "upstream_error": ("MiniMax 上游异常", "观察下一次刷新,连续失败再切人工检查"),
    "network_error": ("网络异常", "检查 207 到 platform.minimaxi.com 的连通性"),
    "schema_error": ("返回结构变化", "需要更新解析逻辑"),
    "http_error": ("HTTP 异常", "查看状态码与响应摘要"),
}


class MiniMaxCollectError(RuntimeError):
    def __init__(self, error_type: str, detail: str):
        super().__init__(detail)
        self.error_type = error_type
        self.detail = detail


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _looks_like_login_page(body: str) -> bool:
    lowered = body[:2000].lower()
    return (
        "<html" in lowered
        or "login" in lowered
        or "sign in" in lowered
        or "登录" in body[:2000]
    )


def _summarize_body(body: str, limit: int = 180) -> str:
    one_line = " ".join(body.strip().split())
    return one_line[:limit]


def _request_json(path: str, cookie: str, group_id: str = "") -> dict[str, Any]:
    headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9",
        "cookie": cookie,
        "origin": MINIMAX_PLATFORM_ORIGIN,
        "referer": f"{MINIMAX_PLATFORM_ORIGIN}/",
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148 Safari/537.36"
        ),
    }
    if group_id:
        headers["x-group-id"] = group_id
    req = urllib.request.Request(
        f"{MINIMAX_API_ORIGIN}{path}",
        headers=headers,
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=config.MINIMAX_TIMEOUT_SECONDS) as resp:  # noqa: S310
        content_type = resp.headers.get("content-type", "")
        body = resp.read().decode("utf-8", errors="replace")
    if "application/json" not in content_type and _looks_like_login_page(body):
        raise MiniMaxCollectError("auth_expired", "MiniMax returned a login page")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        if _looks_like_login_page(body):
            raise MiniMaxCollectError("auth_expired", "MiniMax returned a login page") from exc
        raise MiniMaxCollectError("schema_error", f"Invalid JSON: {_summarize_body(body)}") from exc
    if not isinstance(data, dict):
        raise MiniMaxCollectError("schema_error", "MiniMax returned a non-object JSON payload")
    _raise_for_base_resp(data)
    return data


def _raise_for_base_resp(data: dict[str, Any]) -> None:
    base_resp = data.get("base_resp")
    if not isinstance(base_resp, dict):
        return
    status = base_resp.get("status_code")
    if status in (None, "", 0, "0"):
        return
    message = str(base_resp.get("status_msg") or base_resp.get("message") or status)
    if str(status) in {"1004", "401", "403"}:
        raise MiniMaxCollectError("auth_expired", f"MiniMax auth failed: {message}")
    raise MiniMaxCollectError("upstream_error", f"MiniMax base_resp {status}: {message}")


def _parse_minimax_time(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            timestamp = float(stripped)
            if timestamp > 10_000_000_000:
                timestamp /= 1000
            return datetime.fromtimestamp(timestamp, tz=timezone.utc)
        return datetime.fromisoformat(stripped.replace("Z", "+00:00"))
    return None


def _format_time_range(start: Any, end: Any, weekly: bool = False) -> str:
    if not start or not end:
        return ""
    try:
        parsed_start = _parse_minimax_time(start)
        parsed_end = _parse_minimax_time(end)
        if not parsed_start or not parsed_end:
            return ""
        a = parsed_start.astimezone(CN_TZ).strftime("%m/%d %H:%M" if weekly else "%H:%M")
        b = parsed_end.astimezone(CN_TZ).strftime("%m/%d %H:%M" if weekly else "%H:%M")
    except (TypeError, ValueError, OSError):
        return ""
    return f"{a} - {b}(UTC+8)" if weekly else f"{a}-{b}(UTC+8)"


def _format_remaining(ms: Any) -> str:
    try:
        total_seconds = max(0, int(float(ms) / 1000))
    except (TypeError, ValueError):
        total_seconds = 0
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    if hours:
        return f"{hours} 小时{f' {minutes} 分钟' if minutes else ''}后重置"
    return f"{minutes} 分钟后重置"


def _format_datetime_ms(value: Any) -> str:
    parsed = _parse_minimax_time(value)
    if not parsed:
        return ""
    return parsed.astimezone(CN_TZ).strftime("%Y-%m-%d %H:%M:%S(UTC+8)")


def _days_until_ms(value: Any) -> int | None:
    parsed = _parse_minimax_time(value)
    if not parsed:
        return None
    seconds = (parsed - datetime.now(timezone.utc)).total_seconds()
    return max(0, int(seconds // 86400))


def _normalize_quota(row: dict[str, Any], weekly: bool = False) -> dict[str, Any]:
    total_key = "current_weekly_total_count" if weekly else "current_interval_total_count"
    remaining_key = "current_weekly_usage_count" if weekly else "current_interval_usage_count"
    start_key = "weekly_start_time" if weekly else "start_time"
    end_key = "weekly_end_time" if weekly else "end_time"
    remains_key = "weekly_remains_time" if weekly else "remains_time"

    total = int(row.get(total_key) or 0)
    remaining = int(row.get(remaining_key) or 0)
    remaining_percent_key = "current_weekly_remaining_percent" if weekly else "current_interval_remaining_percent"
    remaining_percent = row.get(remaining_percent_key)
    if total > 0:
        used = max(0, total - remaining)
        percent = round(used / total * 100)
    elif remaining_percent not in (None, ""):
        total = 100
        remaining = max(0, min(100, int(float(remaining_percent))))
        used = max(0, 100 - remaining)
        percent = used
    else:
        used = 0
        percent = 0
    return {
        "total": total,
        "used": used,
        "remaining": remaining,
        "percent": percent,
        "time_range": _format_time_range(row.get(start_key), row.get(end_key), weekly),
        "reset_text": _format_remaining(row.get(remains_key)),
    }


def _pick_text_generation(remains: dict[str, Any]) -> dict[str, Any] | None:
    categories = remains.get("category_remains") or []
    models = remains.get("model_remains") or []

    row = next(
        (
            item
            for item in categories
            if item.get("category") == "text_generation" or item.get("display_name") == "文本生成"
        ),
        None,
    )
    source = "category_remains"
    if row is None:
        row = next((item for item in models if item.get("model_name") == "MiniMax-M*"), None)
        source = "model_remains"
    if row is None:
        row = next((item for item in models if item.get("model_name") == "general"), None)
        source = "model_remains"
    if row is None:
        return None

    weekly = (
        _normalize_quota(row, weekly=True)
        if int(row.get("current_weekly_total_count") or 0) > 0
        or row.get("current_weekly_remaining_percent") not in (None, "")
        else None
    )
    return {
        "title": row.get("display_name") or ("文本生成" if row.get("model_name") == "general" else "文本生成"),
        "source": source,
        "raw_name": row.get("category") or row.get("model_name") or "",
        "five_hour": _normalize_quota(row, weekly=False),
        "weekly": weekly,
    }


def _pick_coding_package(resource_package: dict[str, Any]) -> dict[str, Any] | None:
    data = resource_package.get("resource_package_data") or {}
    details = data.get("resource_package_details") or []
    if not isinstance(details, list) or not details:
        return None

    def score(item: dict[str, Any]) -> int:
        name = str(item.get("package_name") or "").lower()
        models = [str(model).lower() for model in item.get("models") or []]
        points = 0
        if "code" in name or "coding" in name:
            points += 3
        if any("coding-plan" in model or model == "minimax-m*" for model in models):
            points += 2
        if any("minimax-m2" in model or "minimax-m3" in model for model in models):
            points += 1
        return points

    rows = [item for item in details if isinstance(item, dict)]
    row = max(rows, key=score, default=None)
    if not row:
        return None
    expiration_time = row.get("expiration_time")
    effective_time = row.get("effective_time")
    return {
        "package_id": row.get("package_id") or "",
        "package_name": row.get("package_name") or "",
        "status": row.get("status"),
        "effective_time": effective_time,
        "expiration_time": expiration_time,
        "effective_text": _format_datetime_ms(effective_time),
        "expiration_text": _format_datetime_ms(expiration_time),
        "days_remaining": _days_until_ms(expiration_time),
        "total_count": row.get("total_count"),
        "usage_count": row.get("usage_count"),
        "remains_count": row.get("remains_count"),
        "current_balance": data.get("current_balance"),
        "near_expiry_balance": data.get("near_expiry_balance"),
    }


def _collect_account(plan: dict[str, str]) -> dict[str, Any]:
    start = time.time()
    item: dict[str, Any] = {
        "tag": plan["tag"],
        "name": plan["name"],
        "ok": False,
        "error": None,
        "error_type": None,
        "error_detail": None,
        "error_action": None,
        "consecutive_failures": 0,
        "updated_at": _iso_now(),
        "latency_ms": None,
        "text_generation": None,
        "package": None,
    }
    try:
        remains = _request_json(REMAINS_PATH, plan["cookie"], plan.get("group_id") or "")
        text_generation = _pick_text_generation(remains)
        if not text_generation:
            raise MiniMaxCollectError("schema_error", "MiniMax returned no text_generation quota")
        package_payload = _request_json(RESOURCE_PACKAGE_PATH, plan["cookie"], plan.get("group_id") or "")
        item["ok"] = True
        item["text_generation"] = text_generation
        item["package"] = _pick_coding_package(package_payload)
        item["base_resp"] = remains.get("base_resp")
    except MiniMaxCollectError as exc:
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
        item["consecutive_failures"] = _record_result(plan["tag"], item["ok"])
    return item


def _http_error_detail(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        body = ""
    if body and _looks_like_login_page(body):
        return f"HTTP {exc.code}: MiniMax returned a login page"
    return f"HTTP {exc.code}{': ' + _summarize_body(body) if body else ''}"


def _set_error(item: dict[str, Any], error_type: str, detail: str) -> None:
    label, action = ERROR_MESSAGES.get(error_type, ("采集失败", "查看日志"))
    item["error_type"] = error_type
    item["error_detail"] = detail
    item["error_action"] = action
    item["error"] = f"{label}: {detail}"


def _record_result(tag: str, ok: bool) -> int:
    with _failure_lock:
        if ok:
            _failure_counts[tag] = 0
        else:
            _failure_counts[tag] = _failure_counts.get(tag, 0) + 1
        return _failure_counts[tag]


def _mock_account(idx: int) -> dict[str, Any]:
    total = 4500
    used = random.randint(200, 1800)
    weekly_total = 45_000
    weekly_used = random.randint(3000, 18_000)
    return {
        "tag": f"minimax-{idx}",
        "name": f"MiniMax Token Plan {idx}",
        "ok": True,
        "error": None,
        "error_type": None,
        "error_detail": None,
        "error_action": None,
        "consecutive_failures": 0,
        "updated_at": _iso_now(),
        "latency_ms": random.randint(180, 900),
        "text_generation": {
            "title": "文本生成",
            "source": "mock",
            "raw_name": "text_generation",
            "five_hour": {
                "total": total,
                "used": used,
                "remaining": total - used,
                "percent": round(used / total * 100),
                "time_range": "20:00-00:00(UTC+8)",
                "reset_text": "2 小时 29 分钟后重置",
            },
            "weekly": {
                "total": weekly_total,
                "used": weekly_used,
                "remaining": weekly_total - weekly_used,
                "percent": round(weekly_used / weekly_total * 100),
                "time_range": "05/25 00:00 - 06/01 00:00(UTC+8)",
                "reset_text": "3 天后重置",
            },
        },
        "package": {
            "package_id": f"mock-{idx}",
            "package_name": "codeplan",
            "status": 1,
            "effective_text": "2026-05-17 00:00:00(UTC+8)",
            "expiration_text": "2026-06-16 23:59:59(UTC+8)",
            "days_remaining": 18,
            "current_balance": 600000,
            "near_expiry_balance": 600000,
        },
    }


def collect(force: bool = False) -> dict[str, Any]:
    global _cache_at, _cache_payload

    now = time.time()
    with _cache_lock:
        if (
            not force
            and _cache_payload is not None
            and now - _cache_at < config.MINIMAX_REFRESH_SECONDS
        ):
            cached = dict(_cache_payload)
            cached["cache"] = {"hit": True, "age_seconds": round(now - _cache_at)}
            return cached

    if config.MOCK_MODE:
        accounts = [_mock_account(1), _mock_account(2), _mock_account(3)]
    else:
        plans = config.get_minimax_token_plans()
        accounts = [_collect_account(plan) for plan in plans]

    payload = {
        "enabled": bool(accounts),
        "refresh_seconds": config.MINIMAX_REFRESH_SECONDS,
        "updated_at": _iso_now(),
        "accounts": accounts,
        "summary": _build_summary(accounts),
        "cache": {"hit": False, "age_seconds": 0},
    }

    with _cache_lock:
        _cache_payload = payload
        _cache_at = time.time()
    return payload


def _build_summary(accounts: list[dict[str, Any]]) -> dict[str, Any]:
    ok_accounts = [a for a in accounts if a.get("ok") and a.get("text_generation")]
    error_counts: dict[str, int] = {}
    for account in accounts:
        error_type = account.get("error_type")
        if error_type:
            error_counts[error_type] = error_counts.get(error_type, 0) + 1
    if not ok_accounts:
        return {
            "ok": 0,
            "total": len(accounts),
            "degraded": len(accounts),
            "error_counts": error_counts,
            "five_hour_percent": None,
            "weekly_percent": None,
        }

    def agg(window: str) -> dict[str, int | float | None]:
        total = 0
        used = 0
        remaining = 0
        for account in ok_accounts:
            quota = account["text_generation"].get(window)
            if not quota:
                continue
            total += int(quota.get("total") or 0)
            used += int(quota.get("used") or 0)
            remaining += int(quota.get("remaining") or 0)
        return {
            "total": total,
            "used": used,
            "remaining": remaining,
            "percent": round(used / total * 100) if total > 0 else None,
        }

    five_hour = agg("five_hour")
    weekly = agg("weekly")
    return {
        "ok": len(ok_accounts),
        "total": len(accounts),
        "degraded": len(accounts) - len(ok_accounts),
        "error_counts": error_counts,
        "five_hour": five_hour,
        "weekly": weekly,
        "five_hour_percent": five_hour["percent"],
        "weekly_percent": weekly["percent"],
    }
