"""SQLite 访问层。极薄一层，所有 SQL 写在这里集中管理。"""

from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS upgrade_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT    NOT NULL,
    order_no        TEXT    NOT NULL,
    invite_code     TEXT    DEFAULT '',
    own_invite_code TEXT    NOT NULL,
    ip              TEXT    DEFAULT '',
    user_agent      TEXT    DEFAULT '',
    status          TEXT    NOT NULL DEFAULT 'queued',
    -- 用户粘贴的 ChatGPT session 在磁盘的相对路径 (相对 data_dir/sessions/)
    session_file    TEXT    DEFAULT '',
    -- 是否同时存了转换后的 CPA auth.json
    has_auth        INTEGER NOT NULL DEFAULT 0,
    -- session 解析出来的 plan_type/account_id (admin 一眼看清是 free/plus/pro)
    session_email   TEXT    DEFAULT '',
    session_plan    TEXT    DEFAULT '',
    -- 管理员备注 (人工标记完成原因/退款理由等)
    note            TEXT    DEFAULT '',
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_email ON upgrade_orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_order_no ON upgrade_orders(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_own_invite ON upgrade_orders(own_invite_code);
CREATE INDEX IF NOT EXISTS idx_orders_created ON upgrade_orders(created_at);

CREATE TABLE IF NOT EXISTS invite_uses (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code   TEXT NOT NULL,
    used_by_email TEXT NOT NULL,
    used_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invite_uses(invite_code);

CREATE TABLE IF NOT EXISTS ota_jobs (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL,
    payload     TEXT DEFAULT '',
    log         TEXT DEFAULT '',
    started_at  INTEGER NOT NULL,
    finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS ota_backups (
    id            TEXT PRIMARY KEY,
    path          TEXT NOT NULL,
    commit_before TEXT DEFAULT '',
    note          TEXT DEFAULT '',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
);
"""


_lock = threading.Lock()


def now_ts() -> int:
    return int(time.time())


# 旧库可能没有这些列;启动时通过 ALTER TABLE 补齐 (SQLite 不支持 IF NOT EXISTS for column)
_BACKFILL_COLUMNS: list[tuple[str, str]] = [
    ("session_file", "TEXT DEFAULT ''"),
    ("has_auth", "INTEGER NOT NULL DEFAULT 0"),
    ("session_email", "TEXT DEFAULT ''"),
    ("session_plan", "TEXT DEFAULT ''"),
    ("note", "TEXT DEFAULT ''"),
]


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)
        # 老库迁移:upgrade_orders 缺列时补
        existing = {row[1] for row in conn.execute("PRAGMA table_info(upgrade_orders)").fetchall()}
        for col, decl in _BACKFILL_COLUMNS:
            if col not in existing:
                conn.execute(f"ALTER TABLE upgrade_orders ADD COLUMN {col} {decl}")
        conn.commit()


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    # 写入用全局锁，避免并发提交时 SQLite "database is locked"
    with _lock:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()
