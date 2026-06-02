"""Admin controls for MiniMax-backed NewAPI channels."""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
import time
from pathlib import Path

import pymysql
import pymysql.cursors

import config
import throttle_admin

logger = logging.getLogger("status-page.minimax-admin")

CHANNEL_ENABLED = 1
CHANNEL_MANUAL_DISABLED = 2
NEWAPI_INTERNAL_URL = throttle_admin.NEWAPI_INTERNAL_URL


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


def get_status() -> dict:
    ids = config.get_minimax_channel_ids()
    if not ids:
        return {"configured": False, "enabled": False, "channel_ids": [], "channels": []}
    placeholders = ",".join(["%s"] * len(ids))
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id,name,status,models,used_quota FROM channels WHERE id IN ({placeholders}) ORDER BY id",
                ids,
            )
            rows = cur.fetchall()
    channels = [
        {
            "id": int(row["id"]),
            "name": row.get("name") or f"channel-{row['id']}",
            "status": int(row.get("status") or 0),
            "enabled": int(row.get("status") or 0) == CHANNEL_ENABLED,
            "models": row.get("models") or "",
            "used_quota": int(row.get("used_quota") or 0),
        }
        for row in rows
    ]
    enabled_count = sum(1 for channel in channels if channel["enabled"])
    return {
        "configured": True,
        "enabled": enabled_count > 0,
        "channel_ids": ids,
        "enabled_count": enabled_count,
        "total": len(channels),
        "channels": channels,
        "plans": get_plan_statuses(),
    }


def set_enabled(enabled: bool) -> dict:
    ids = config.get_minimax_channel_ids()
    if not ids:
        return {"ok": False, "error": "MINIMAX_CHANNEL_IDS 未配置"}

    if enabled:
        affected = _restore_channel_statuses(ids)
    else:
        snapshot = get_status()
        _save_channel_snapshot(snapshot)
        target = CHANNEL_MANUAL_DISABLED
        placeholders = ",".join(["%s"] * len(ids))
        with _mysql_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE channels SET status=%s WHERE id IN ({placeholders})",
                    [target, *ids],
                )
                affected = cur.rowcount
            conn.commit()

    cache_refresh = _refresh_newapi_channel_cache()
    status = get_status()
    return {
        "ok": True,
        "enabled": enabled,
        "affected": affected,
        "cache_refresh": cache_refresh,
        "status": status,
    }


def get_plan_statuses() -> list[dict]:
    mapping = config.get_minimax_plan_channel_map()
    if not mapping:
        return []
    rows = _fetch_channels(sorted({channel_id for ids in mapping.values() for channel_id in ids}))
    rows_by_id = {int(row["id"]): row for row in rows}
    state = _load_plan_state()
    plans_state = state.get("plans") if isinstance(state.get("plans"), dict) else {}
    out: list[dict] = []
    for tag, ids in mapping.items():
        channels = [_channel_row_to_payload(rows_by_id[channel_id]) for channel_id in ids if channel_id in rows_by_id]
        enabled_count = sum(1 for channel in channels if channel["enabled"])
        plan_state = plans_state.get(tag) if isinstance(plans_state.get(tag), dict) else {}
        out.append(
            {
                "tag": tag,
                "channel_ids": ids,
                "channels": channels,
                "enabled": enabled_count > 0,
                "enabled_count": enabled_count,
                "total": len(channels),
                "auto_disabled": bool(plan_state.get("auto_disabled")),
                "manual_disabled": bool(plan_state.get("manual_disabled")),
                "reason": plan_state.get("reason") or "",
                "updated_at": plan_state.get("updated_at"),
            }
        )
    return out


def set_plan_enabled(tag: str, enabled: bool, manual: bool = True, reason: str = "") -> dict:
    tag = tag.strip()
    mapping = config.get_minimax_plan_channel_map()
    ids = mapping.get(tag)
    if not ids:
        return {"ok": False, "error": f"未知 MiniMax 套餐: {tag}"}

    state = _load_plan_state()
    plans_state = state.setdefault("plans", {})
    plan_state = plans_state.setdefault(tag, {})

    if enabled:
        snapshots = []
        if manual:
            snapshots.append(plan_state.get("manual_statuses"))
        snapshots.append(plan_state.get("auto_statuses"))
        affected = _restore_from_snapshots(ids, snapshots)
        if manual:
            plan_state["manual_disabled"] = False
            plan_state.pop("manual_statuses", None)
        plan_state["auto_disabled"] = False
        plan_state.pop("auto_statuses", None)
        plan_state["reason"] = reason or "enabled"
    else:
        current = _fetch_channels(ids)
        statuses = {str(row["id"]): int(row.get("status") or 0) for row in current}
        if manual:
            plan_state["manual_disabled"] = True
            plan_state["manual_statuses"] = statuses
        else:
            plan_state["auto_disabled"] = True
            plan_state["auto_statuses"] = statuses
        plan_state["reason"] = reason or ("manual_disabled" if manual else "auto_disabled")
        affected = _set_channel_statuses(ids, CHANNEL_MANUAL_DISABLED)

    plan_state["updated_at"] = int(time.time())
    _save_plan_state(state)
    cache_refresh = _refresh_newapi_channel_cache()
    return {
        "ok": True,
        "tag": tag,
        "enabled": enabled,
        "affected": affected,
        "cache_refresh": cache_refresh,
        "status": get_status(),
    }


def auto_guard(minimax_payload: dict) -> dict:
    actions: list[dict] = []
    if not minimax_payload.get("enabled"):
        return {"ok": True, "actions": actions}
    plan_statuses = {item["tag"]: item for item in get_plan_statuses()}
    state = _load_plan_state()
    plans_state = state.get("plans") if isinstance(state.get("plans"), dict) else {}

    for account in minimax_payload.get("accounts") or []:
        tag = str(account.get("tag") or "")
        if tag not in plan_statuses or not account.get("ok"):
            continue
        weekly = ((account.get("text_generation") or {}).get("weekly") or {})
        percent = int(weekly.get("percent") or 0)
        plan_state = plans_state.get(tag) if isinstance(plans_state.get(tag), dict) else {}
        plan_status = plan_statuses[tag]

        if percent >= config.MINIMAX_AUTO_DISABLE_WEEKLY_PERCENT and plan_status.get("enabled"):
            result = set_plan_enabled(
                tag,
                False,
                manual=False,
                reason=f"weekly quota reached {percent}%",
            )
            actions.append({"tag": tag, "action": "auto_disabled", "percent": percent, "ok": result.get("ok")})
        elif (
            percent >= config.MINIMAX_AUTO_DISABLE_WEEKLY_PERCENT
            and not bool(plan_state.get("auto_disabled"))
            and not bool(plan_state.get("manual_disabled"))
        ):
            result = _mark_plan_auto_disabled(
                tag,
                reason=f"weekly quota reached {percent}%",
            )
            actions.append({"tag": tag, "action": "auto_marked_disabled", "percent": percent, "ok": result.get("ok")})
        elif (
            bool(plan_state.get("auto_disabled"))
            and not bool(plan_state.get("manual_disabled"))
            and percent < config.MINIMAX_AUTO_REENABLE_WEEKLY_PERCENT
        ):
            result = set_plan_enabled(
                tag,
                True,
                manual=False,
                reason=f"weekly quota back to {percent}%",
            )
            actions.append({"tag": tag, "action": "auto_reenabled", "percent": percent, "ok": result.get("ok")})
    return {"ok": True, "actions": actions}


def _mark_plan_auto_disabled(tag: str, reason: str = "") -> dict:
    mapping = config.get_minimax_plan_channel_map()
    ids = mapping.get(tag)
    if not ids:
        return {"ok": False, "error": f"未知 MiniMax 套餐: {tag}"}

    current = _fetch_channels(ids)
    statuses = {str(row["id"]): int(row.get("status") or 0) for row in current}
    state = _load_plan_state()
    plans_state = state.setdefault("plans", {})
    plan_state = plans_state.setdefault(tag, {})
    plan_state["auto_disabled"] = True
    plan_state["auto_statuses"] = statuses
    plan_state["reason"] = reason or "auto_disabled"
    plan_state["updated_at"] = int(time.time())
    _save_plan_state(state)
    return {"ok": True, "tag": tag, "affected": 0, "status": get_status()}


def _restore_channel_statuses(ids: list[int]) -> int:
    snapshot = _load_channel_snapshot()
    prior_statuses = snapshot.get("statuses") if isinstance(snapshot, dict) else None
    if not isinstance(prior_statuses, dict):
        prior_statuses = {str(channel_id): CHANNEL_ENABLED for channel_id in ids}

    cases: list[str] = []
    values: list[int] = []
    for channel_id in ids:
        raw_status = prior_statuses.get(str(channel_id), CHANNEL_ENABLED)
        try:
            status = int(raw_status)
        except (TypeError, ValueError):
            status = CHANNEL_ENABLED
        cases.append("WHEN %s THEN %s")
        values.extend([channel_id, status])

    placeholders = ",".join(["%s"] * len(ids))
    sql = (
        "UPDATE channels SET status = CASE id "
        + " ".join(cases)
        + f" END WHERE id IN ({placeholders})"
    )
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, [*values, *ids])
            affected = cur.rowcount
        conn.commit()
    return affected


def _fetch_channels(ids: list[int]) -> list[dict]:
    if not ids:
        return []
    placeholders = ",".join(["%s"] * len(ids))
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT id,name,status,models,used_quota FROM channels WHERE id IN ({placeholders}) ORDER BY id",
                ids,
            )
            return cur.fetchall()


def _channel_row_to_payload(row: dict) -> dict:
    return {
        "id": int(row["id"]),
        "name": row.get("name") or f"channel-{row['id']}",
        "status": int(row.get("status") or 0),
        "enabled": int(row.get("status") or 0) == CHANNEL_ENABLED,
        "models": row.get("models") or "",
        "used_quota": int(row.get("used_quota") or 0),
    }


def _set_channel_statuses(ids: list[int], status: int) -> int:
    placeholders = ",".join(["%s"] * len(ids))
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE channels SET status=%s WHERE id IN ({placeholders})",
                [status, *ids],
            )
            affected = cur.rowcount
        conn.commit()
    return affected


def _restore_from_snapshots(ids: list[int], snapshots: list[object]) -> int:
    statuses: dict[str, int] = {}
    for snapshot in snapshots:
        if isinstance(snapshot, dict):
            for channel_id, status in snapshot.items():
                try:
                    statuses[str(int(channel_id))] = int(status)
                except (TypeError, ValueError):
                    continue
            if statuses:
                break
    if not statuses:
        statuses = {str(channel_id): CHANNEL_ENABLED for channel_id in ids}

    cases: list[str] = []
    values: list[int] = []
    for channel_id in ids:
        status = statuses.get(str(channel_id), CHANNEL_ENABLED)
        cases.append("WHEN %s THEN %s")
        values.extend([channel_id, int(status)])
    placeholders = ",".join(["%s"] * len(ids))
    sql = (
        "UPDATE channels SET status = CASE id "
        + " ".join(cases)
        + f" END WHERE id IN ({placeholders})"
    )
    with _mysql_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, [*values, *ids])
            affected = cur.rowcount
        conn.commit()
    return affected


def _save_channel_snapshot(status: dict) -> None:
    path = Path(config.MINIMAX_CHANNEL_STATE_DB)
    path.parent.mkdir(parents=True, exist_ok=True)
    statuses = {str(channel["id"]): channel["status"] for channel in status.get("channels") or []}
    path.write_text(
        json.dumps({"saved_at": int(time.time()), "statuses": statuses}, ensure_ascii=False, indent=2)
    )


def _load_channel_snapshot() -> dict:
    path = Path(config.MINIMAX_CHANNEL_STATE_DB)
    try:
        return json.loads(path.read_text())
    except Exception:  # noqa: BLE001
        return {}


def _load_plan_state() -> dict:
    path = Path(config.MINIMAX_PLAN_STATE_DB)
    try:
        state = json.loads(path.read_text())
        return state if isinstance(state, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _save_plan_state(state: dict) -> None:
    path = Path(config.MINIMAX_PLAN_STATE_DB)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def _refresh_newapi_channel_cache() -> dict:
    admin_token = throttle_admin._get_admin_token()
    if not admin_token:
        return {"ok": False, "error": "无法获取 admin token,数据库已更新但缓存可能延迟"}
    body = {"tag": "__status_page_cache_refresh__"}
    req = urllib.request.Request(
        url=f"{NEWAPI_INTERNAL_URL}/api/channel/tag/enabled",
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {admin_token}",
            "New-Api-User": "1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
            data = resp.read().decode("utf-8", errors="replace")
        return {"ok": True, "newapi_response": data}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore") if exc.fp else ""
        return {"ok": False, "error": f"NewAPI HTTP {exc.code}: {body}"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("refresh NewAPI channel cache failed: %s", exc)
        return {"ok": False, "error": str(exc)}
