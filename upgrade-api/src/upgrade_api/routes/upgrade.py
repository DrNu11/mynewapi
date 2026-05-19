"""业务接口：/api/upgrade/*

提交升级申请、查询排队人数 + 邀请进度。简单、幂等友好（同一邮箱+订单号会去重）。

session_json:
    用户从 https://chatgpt.com/api/auth/session 复制的 JSON,原样存到
    `<data_dir>/sessions/<order_id>.json`。如果前端同时传了 authJson
    (chatgpt2cpa /api/convert 转换好的 CPA auth.json),再多存一份
    `<order_id>-auth.json`,管理员可直接下载使用。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request

from ..config import get_settings
from ..db import connect, now_ts
from ..models import UpgradeSubmitIn, UpgradeSubmitOut, UpgradeStatsOut
from ..session_converter import build_codex_auth_json

router = APIRouter(prefix="/api/upgrade", tags=["upgrade"])


def _own_invite_code(email: str) -> str:
    """从邮箱派生稳定的邀请码，6 位数字。"""
    normalized = email.strip().lower()
    h = 0
    for ch in normalized:
        h = (h * 31 + ord(ch)) % 1_000_000
    return f"GP{h:06d}"


def _client_ip(request: Request) -> str:
    # 经 nginx + CF 反代，取 X-Forwarded-For 第一项
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def _sessions_dir() -> Path:
    s = get_settings()
    d = s.data_dir / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    # 防止被 nginx 误把 sessions 目录 autoindex 出来
    os.chmod(d, 0o700)
    return d


def _write_secure_json(path: Path, body: str) -> None:
    """以 0600 权限原子写文件 (避免误授权访问 token)。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(body)
    os.replace(tmp, path)


def _convert_session(raw_json: str) -> tuple[bool, dict[str, Any] | None, list[str], str]:
    """后端自动:解析 session → 生成 CPA auth.json。

    返回 (ok, auth_data, warnings, error_msg)。
    ok=False 时 error_msg 描述失败原因 (前端可显示给用户)。
    """
    try:
        source = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError) as exc:
        return False, None, [], f"session 不是合法 JSON: {exc}"
    try:
        result = build_codex_auth_json(source, requested_filename="")
    except ValueError as exc:
        return False, None, [], str(exc)
    return True, result.auth_data, list(result.warnings), ""


def _persist_session_files(
    order_id: int, raw_session: str, auth_data: dict[str, Any] | None
) -> tuple[str, bool]:
    """把 session/auth 写入磁盘。返回 (session_file_name, has_auth)。"""
    sdir = _sessions_dir()
    file_name = f"{order_id}.json"
    _write_secure_json(sdir / file_name, raw_session)
    has_auth = False
    if auth_data is not None and isinstance(auth_data, dict):
        auth_body = json.dumps(auth_data, ensure_ascii=False, indent=2)
        _write_secure_json(sdir / f"{order_id}-auth.json", auth_body)
        has_auth = True
    return file_name, has_auth


@router.post("/submit", response_model=UpgradeSubmitOut)
def submit(payload: UpgradeSubmitIn, request: Request) -> UpgradeSubmitOut:
    s = get_settings()
    email = str(payload.email).lower().strip()
    order = payload.order.strip()
    invite_code = payload.inviteCode.strip()
    raw_session = payload.sessionJson.strip()
    own = _own_invite_code(email)
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")[:300]

    # 后端自动转换 session → CPA auth.json (不再依赖前端传 authJson)
    if raw_session:
        session_ok, auth_data, session_warnings, session_err = _convert_session(raw_session)
    else:
        session_ok, auth_data, session_warnings, session_err = False, None, [], ""

    # 从 auth_data 取权威 email/plan,作为 admin 列表预览字段
    session_email = (auth_data.get("email") if auth_data else "")[:120] if auth_data else ""
    session_plan = (auth_data.get("plan_type") if auth_data else "")[:32] if auth_data else ""

    with connect(s.db_path) as conn:
        # 去重：同邮箱+订单号，已存在就直接返回当前状态（不重复入库）
        existing = conn.execute(
            "SELECT id FROM upgrade_orders WHERE email = ? AND order_no = ?",
            (email, order),
        ).fetchone()

        if not existing:
            cur = conn.execute(
                """INSERT INTO upgrade_orders
                       (email, order_no, invite_code, own_invite_code, ip, user_agent, status,
                        session_file, has_auth, session_email, session_plan, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'queued',
                           '', 0, ?, ?, ?)""",
                (email, order, invite_code, own, ip, ua, session_email, session_plan, now_ts()),
            )
            order_id = int(cur.lastrowid)

            # 写 session 原文 + 后端转出的 auth.json (前端 authJson 被忽略,防伪造)
            if raw_session and session_ok:
                file_name, has_auth = _persist_session_files(order_id, raw_session, auth_data)
                conn.execute(
                    "UPDATE upgrade_orders SET session_file=?, has_auth=? WHERE id=?",
                    (file_name, 1 if has_auth else 0, order_id),
                )

            invite_accepted = False
            if invite_code:
                # 校验：邀请码必须真的存在于某个已提交记录里
                hit = conn.execute(
                    "SELECT 1 FROM upgrade_orders WHERE own_invite_code = ? AND email != ? LIMIT 1",
                    (invite_code, email),
                ).fetchone()
                if hit:
                    conn.execute(
                        "INSERT INTO invite_uses (invite_code, used_by_email, used_at) VALUES (?, ?, ?)",
                        (invite_code, email, now_ts()),
                    )
                    invite_accepted = True
        else:
            invite_accepted = False

        queue_count = conn.execute("SELECT COUNT(*) AS c FROM upgrade_orders").fetchone()["c"]
        invite_count = conn.execute(
            "SELECT COUNT(*) AS c FROM invite_uses WHERE invite_code = ?",
            (own,),
        ).fetchone()["c"]

    # 组装提示消息
    parts: list[str] = []
    if invite_accepted:
        parts.append(f"已使用邀请码 {invite_code},并被记入有效邀请。")
    elif invite_code:
        parts.append(f"邀请码 {invite_code} 未匹配到任何已提交记录,已忽略。")
    if raw_session:
        if session_ok:
            label = f" ({session_plan})" if session_plan else ""
            warn_tail = f" ({len(session_warnings)} 条警告)" if session_warnings else ""
            parts.append(f"✅ Session 已收到{label},稍等排队升级中…{warn_tail}")
        else:
            parts.append(f"⚠️ session 不可用:{session_err},已忽略,请重新粘贴。")
    else:
        parts.append("提示:粘贴 ChatGPT session JSON 才能在线升级。")
    parts.append(f"当前累计邀请 {invite_count} 人,可消耗免单机会 {invite_count} 次。")
    msg = " ".join(parts)

    return UpgradeSubmitOut(
        queueCount=queue_count,
        ownInviteCode=own,
        inviteAccepted=invite_accepted,
        inviteCount=invite_count,
        inviteCredits=invite_count,
        sessionAccepted=bool(raw_session and session_ok),
        sessionPlan=session_plan,
        message=msg,
    )


@router.get("/stats", response_model=UpgradeStatsOut)
def stats(invite: str = "") -> UpgradeStatsOut:
    s = get_settings()
    invite = invite.strip()
    with connect(s.db_path) as conn:
        queue_count = conn.execute("SELECT COUNT(*) AS c FROM upgrade_orders").fetchone()["c"]
        own_invite = 0
        if invite:
            own_invite = conn.execute(
                "SELECT COUNT(*) AS c FROM invite_uses WHERE invite_code = ?",
                (invite,),
            ).fetchone()["c"]
    return UpgradeStatsOut(queueCount=queue_count, ownInviteCount=own_invite)
