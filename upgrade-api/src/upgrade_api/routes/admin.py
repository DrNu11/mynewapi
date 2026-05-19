"""管理员接口：查看订单列表 + 下载 session/auth + 改状态 + 详情可视化 + 去重 + 批量导出。需 admin token。"""

from __future__ import annotations

import io
import json
import re
import time
import zipfile
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from ..auth import require_admin
from ..config import get_settings
from ..db import connect, now_ts
from ..models import DedupGroup, DedupResult, OrderItem, OrdersListOut, OrderStatusIn
from ..session_converter import build_codex_auth_json

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _row_to_order_item(r) -> OrderItem:
    # sqlite3.Row 转 dict 后兼容 OrderItem;某些列在老库可能为 None
    d = dict(r)
    return OrderItem(
        id=d["id"],
        email=d["email"],
        order_no=d["order_no"],
        invite_code=d.get("invite_code") or "",
        own_invite_code=d["own_invite_code"],
        ip=d.get("ip") or "",
        status=d.get("status") or "queued",
        has_session=bool(d.get("session_file")),
        has_auth=bool(d.get("has_auth")),
        session_email=d.get("session_email") or "",
        session_plan=d.get("session_plan") or "",
        note=d.get("note") or "",
        created_at=d["created_at"],
    )


@router.get("/orders", response_model=OrdersListOut)
def list_orders(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: str = Query("", description="按 email / order_no / invite_code 模糊匹配"),
) -> OrdersListOut:
    s = get_settings()
    where = ""
    params: list = []
    if q:
        where = ("WHERE email LIKE ? OR order_no LIKE ? "
                 "OR own_invite_code LIKE ? OR invite_code LIKE ? "
                 "OR session_email LIKE ?")
        like = f"%{q}%"
        params = [like, like, like, like, like]

    with connect(s.db_path) as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM upgrade_orders {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""SELECT id, email, order_no, invite_code, own_invite_code, ip, status,
                       session_file, has_auth, session_email, session_plan, note, created_at
                  FROM upgrade_orders {where}
                  ORDER BY created_at DESC
                  LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

    items = [_row_to_order_item(r) for r in rows]
    return OrdersListOut(total=total, items=items)


def _resolve_session_file(order_id: int, suffix: str = "") -> Path:
    """根据 order_id 拼出 session 文件路径。

    suffix='' → <id>.json (原始 session)
    suffix='-auth' → <id>-auth.json (CPA 转换结果)
    """
    s = get_settings()
    sdir = s.data_dir / "sessions"
    name = f"{order_id}{suffix}.json"
    path = sdir / name
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"file not found: {name}")
    return path


@router.get("/orders/{order_id}/session", response_class=FileResponse)
def download_session(order_id: int) -> FileResponse:
    """下载用户原始 ChatGPT session JSON。"""
    return FileResponse(
        _resolve_session_file(order_id),
        media_type="application/json",
        filename=f"order-{order_id}-session.json",
    )


@router.get("/orders/{order_id}/auth", response_class=FileResponse)
def download_auth(order_id: int) -> FileResponse:
    """下载已转好的 CPA auth.json。"""
    return FileResponse(
        _resolve_session_file(order_id, "-auth"),
        media_type="application/json",
        filename=f"order-{order_id}-auth.json",
    )


def _safe_token_preview(token: str, head: int = 24, tail: int = 6) -> str:
    """token 预览:只显示头尾,避免完整 access_token 泄露在 admin 面板/日志里。"""
    if not token:
        return ""
    s = str(token)
    if len(s) <= head + tail + 3:
        return s
    return f"{s[:head]}…{s[-tail:]}"


@router.get("/orders/{order_id}/details")
def order_details(order_id: int) -> dict:
    """返回订单的 session 可视化摘要 (供 admin 面板弹窗预览用)。

    若磁盘上有 auth.json (后端已转好) 就直接读;
    否则从原始 session 现场转一次 (兜底,转不出来就只返回订单基础信息)。
    """
    s = get_settings()
    with connect(s.db_path) as conn:
        row = conn.execute(
            """SELECT id, email, order_no, status, session_file, has_auth,
                      session_email, session_plan, note, created_at
                 FROM upgrade_orders WHERE id = ?""",
            (order_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"order {order_id} not found")

    sdir = s.data_dir / "sessions"
    auth_path = sdir / f"{order_id}-auth.json"
    session_path = sdir / f"{order_id}.json"

    auth_data: dict | None = None
    warnings: list[str] = []
    convert_error = ""

    if auth_path.exists():
        # 后端已经存的 auth.json,直接读
        try:
            auth_data = json.loads(auth_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            convert_error = f"读取 auth.json 失败: {exc}"
    elif session_path.exists():
        # 没存 auth.json (老订单或当时转换失败),现场再转一次
        try:
            raw = session_path.read_text(encoding="utf-8")
            source = json.loads(raw)
            result = build_codex_auth_json(source, requested_filename="")
            auth_data = result.auth_data
            warnings = list(result.warnings)
        except (json.JSONDecodeError, ValueError, OSError) as exc:
            convert_error = f"现场转换失败: {exc}"

    # 组装可视化字段:不含完整 token,只露关键摘要
    summary: dict = {
        "id": row["id"],
        "order_no": row["order_no"],
        "submitter_email": row["email"],
        "status": row["status"],
        "note": row["note"] or "",
        "created_at": row["created_at"],
        "has_session_file": session_path.exists(),
        "has_auth_file": auth_path.exists(),
    }
    if auth_data:
        summary.update({
            "session_email": auth_data.get("email", ""),
            "plan_type": auth_data.get("plan_type", ""),
            "account_id": auth_data.get("account_id", ""),
            "expired": auth_data.get("expired", ""),
            "has_access_token": bool(auth_data.get("access_token")),
            "has_refresh_token": bool(auth_data.get("refresh_token")),
            "has_id_token": bool(auth_data.get("id_token")),
            "id_token_synthetic": bool(auth_data.get("id_token_synthetic")),
            "disabled": bool(auth_data.get("disabled")),
            "access_token_preview": _safe_token_preview(auth_data.get("access_token", "")),
            "refresh_token_preview": _safe_token_preview(auth_data.get("refresh_token", "")),
        })
    summary["warnings"] = warnings
    summary["convert_error"] = convert_error
    return summary


@router.post("/orders/{order_id}/status")
def update_status(order_id: int, payload: OrderStatusIn) -> dict:
    """管理员改订单状态并写备注。常用流程:
    queued → processing(人工开始处理)→ done / refunded
    """
    s = get_settings()
    with connect(s.db_path) as conn:
        row = conn.execute("SELECT id FROM upgrade_orders WHERE id = ?", (order_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"order {order_id} not found")
        # 备注追加写,带时间戳,便于审计
        ts = now_ts()
        prefix = f"[{ts}|{payload.status}]"
        new_note_chunk = f"{prefix} {payload.note}".strip() if payload.note else prefix
        conn.execute(
            "UPDATE upgrade_orders SET status = ?, "
            "note = CASE WHEN note = '' OR note IS NULL THEN ? ELSE note || char(10) || ? END "
            "WHERE id = ?",
            (payload.status, new_note_chunk, new_note_chunk, order_id),
        )
    return {"ok": True, "id": order_id, "status": payload.status}


# ---------- 去重 ----------

@router.post("/orders/dedup", response_model=DedupResult)
def dedup_orders(dry_run: bool = Query(True, description="true=只看不动,false=真去重")) -> DedupResult:
    """检查并去除重复提交。

    规则:按提交人邮箱 email 分组,同邮箱出现多条非 refunded 订单时,保留 id 最大那条
    (最新提交,session 最新有效),其余改为 status='refunded' 并在 note 追加溯源标记。
    磁盘上的 session/auth.json 文件**不删**,只是数据库状态变更,便于复核回退。

    默认 dry_run=true → 只返回会做什么,不真改库。
    传 ?dry_run=false 才真执行。
    """
    s = get_settings()
    with connect(s.db_path) as conn:
        # 只看 queued/processing/done 的,refunded 跳过避免重复"合并已合并的"
        rows = conn.execute(
            """SELECT id, email, status, has_auth, created_at
                 FROM upgrade_orders
                WHERE status IN ('queued', 'processing', 'done')
                ORDER BY id DESC""",
        ).fetchall()

        by_email: dict[str, list] = defaultdict(list)
        for r in rows:
            by_email[r["email"]].append(r)

        groups: list[DedupGroup] = []
        for email, orders in by_email.items():
            if len(orders) <= 1:
                continue
            # rows 已按 id DESC 排序,第一个就是最新
            kept = orders[0]
            removed = orders[1:]
            groups.append(DedupGroup(
                email=email,
                kept_id=kept["id"],
                kept_has_auth=bool(kept["has_auth"]),
                removed_ids=[r["id"] for r in removed],
                total=len(orders),
            ))

        merged_total = sum(len(g.removed_ids) for g in groups)

        # 真执行:把 removed_ids 批量改 refunded + 追加备注
        if not dry_run and merged_total > 0:
            ts = now_ts()
            for g in groups:
                tag = f"[{ts}|refunded] [dedup 被 #{g.kept_id} 取代,共 {g.total} 条同邮箱]"
                for rid in g.removed_ids:
                    conn.execute(
                        "UPDATE upgrade_orders SET status = 'refunded', "
                        "note = CASE WHEN note = '' OR note IS NULL THEN ? ELSE note || char(10) || ? END "
                        "WHERE id = ?",
                        (tag, tag, rid),
                    )

    return DedupResult(
        dry_run=dry_run,
        scanned_emails=len(by_email),
        duplicate_emails=len(groups),
        groups=groups,
        merged_total=merged_total,
    )


# ---------- 一键导出所有 auth.json (zip) ----------

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")


def _safe_part(s: str, fallback: str = "unknown") -> str:
    """把任意字符串转成可放进 zip 的安全文件名片段(防 path traversal/特殊字符)。"""
    if not s:
        return fallback
    out = _FILENAME_SAFE_RE.sub("_", str(s)).strip("._-")
    return out or fallback


@router.get("/orders/export-auth-zip")
def export_auth_zip() -> StreamingResponse:
    """打包所有可用 auth.json 成 zip 流返回。

    筛选规则:has_auth=1 AND status != 'refunded'。
    zip 内文件名:`<order_id>-<session_email_safe>-<plan>.json`,
    便于 CPA 端直接放入 auth-dir 或人工抽检。

    同时附带一个 index.txt 列出每个文件来源的订单 id / email / plan / created_at。
    """
    s = get_settings()
    sdir = s.data_dir / "sessions"

    with connect(s.db_path) as conn:
        rows = conn.execute(
            """SELECT id, email, session_email, session_plan, status, created_at
                 FROM upgrade_orders
                WHERE has_auth = 1 AND status != 'refunded'
                ORDER BY id ASC""",
        ).fetchall()

    buf = io.BytesIO()
    index_lines = [
        "# upgrade-api auth.json batch export",
        f"# exported_at: {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC",
        f"# total_records: {len(rows)}",
        "# format: <zip_filename>\\t<order_id>\\t<submitter_email>\\t<session_email>\\t<plan>\\t<status>\\t<created_at>",
        "",
    ]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for r in rows:
            auth_path = sdir / f"{r['id']}-auth.json"
            if not auth_path.exists():
                # 数据库说 has_auth=1 但磁盘没文件 — 跳过,记到 index 里
                index_lines.append(f"(missing)\t{r['id']}\t{r['email']}\t{r['session_email']}\t{r['session_plan']}\t{r['status']}\t{r['created_at']}")
                continue
            email_part = _safe_part(r["session_email"] or r["email"])
            plan_part = _safe_part(r["session_plan"] or "unknown")
            entry_name = f"{r['id']}-{email_part}-{plan_part}.json"
            try:
                content = auth_path.read_bytes()
            except OSError as exc:
                index_lines.append(f"(read_error: {exc})\t{r['id']}\t{r['email']}\t{r['session_email']}\t{r['session_plan']}\t{r['status']}\t{r['created_at']}")
                continue
            zf.writestr(entry_name, content)
            index_lines.append(f"{entry_name}\t{r['id']}\t{r['email']}\t{r['session_email']}\t{r['session_plan']}\t{r['status']}\t{r['created_at']}")
        zf.writestr("_index.txt", "\n".join(index_lines).encode("utf-8"))

    buf.seek(0)
    fname = f"cpa-auths-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "X-Auth-Count": str(len(rows)),
        },
    )
