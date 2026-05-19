import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

/**
 * SQLite 数据库 - 用于存兑换码短链。
 *
 * 数据文件路径：
 *   - 开发：./data/redemptions.db
 *   - 生产：可通过 NASSAAPI_DATA_DIR 环境变量自定义
 *
 * 使用单例模式，避免 Next.js 热重载创建多个连接。
 */

const DATA_DIR = process.env.NASSAAPI_DATA_DIR
  ? path.resolve(process.env.NASSAAPI_DATA_DIR)
  : path.join(process.cwd(), "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "redemptions.db");

declare global {
  // eslint-disable-next-line no-var
  var __nassaapi_db: Database.Database | undefined;
}

function createConnection() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS redemption_links (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      short_id        TEXT UNIQUE NOT NULL,
      redemption_code TEXT NOT NULL,
      newapi_name     TEXT NOT NULL,
      amount_quota    INTEGER NOT NULL,
      amount_usd      REAL,
      memo            TEXT,
      customer_label  TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      revealed_at     TEXT,
      visit_count     INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_redemption_links_short_id
      ON redemption_links(short_id);
    CREATE INDEX IF NOT EXISTS idx_redemption_links_status
      ON redemption_links(status);
    CREATE INDEX IF NOT EXISTS idx_redemption_links_created_at
      ON redemption_links(created_at);
  `);
}

export function getDb(): Database.Database {
  if (!global.__nassaapi_db) {
    global.__nassaapi_db = createConnection();
  }
  return global.__nassaapi_db;
}

// ========== 类型定义 ==========

export interface RedemptionLink {
  id: number;
  short_id: string;
  redemption_code: string;
  newapi_name: string;
  amount_quota: number;
  amount_usd: number | null;
  memo: string | null;
  customer_label: string | null;
  status: "active" | "revealed" | "expired" | "disabled";
  revealed_at: string | null;
  visit_count: number;
  created_at: string;
  expires_at: string | null;
}

// ========== 数据访问函数 ==========

export function insertRedemptionLink(input: {
  short_id: string;
  redemption_code: string;
  newapi_name: string;
  amount_quota: number;
  amount_usd?: number | null;
  memo?: string | null;
  customer_label?: string | null;
  expires_at?: string | null;
}): RedemptionLink {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO redemption_links
      (short_id, redemption_code, newapi_name, amount_quota, amount_usd, memo, customer_label, expires_at)
    VALUES
      (@short_id, @redemption_code, @newapi_name, @amount_quota, @amount_usd, @memo, @customer_label, @expires_at)
    RETURNING *
  `);
  return stmt.get({
    short_id: input.short_id,
    redemption_code: input.redemption_code,
    newapi_name: input.newapi_name,
    amount_quota: input.amount_quota,
    amount_usd: input.amount_usd ?? null,
    memo: input.memo ?? null,
    customer_label: input.customer_label ?? null,
    expires_at: input.expires_at ?? null,
  }) as RedemptionLink;
}

export function getRedemptionLinkByShortId(
  shortId: string
): RedemptionLink | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM redemption_links WHERE short_id = ?`)
    .get(shortId) as RedemptionLink | undefined;
  return row ?? null;
}

/**
 * 按 customer_label 精确查最近的一条有效记录（用于机器人幂等）。
 * 同一订单号重复调用时，直接返回已有短链而不是重复生成码。
 */
export function getActiveLinkByCustomerLabel(
  label: string
): RedemptionLink | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM redemption_links
       WHERE customer_label = ?
         AND status != 'disabled'
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(label) as RedemptionLink | undefined;
  return row ?? null;
}

export function listRedemptionLinks(opts?: {
  limit?: number;
  offset?: number;
}): { rows: RedemptionLink[]; total: number } {
  const db = getDb();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM redemption_links ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as RedemptionLink[];
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM redemption_links`).get() as {
      c: number;
    }
  ).c;
  return { rows, total };
}

export function markRevealed(shortId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE redemption_links
     SET visit_count = visit_count + 1,
         revealed_at = COALESCE(revealed_at, CURRENT_TIMESTAMP),
         status      = CASE WHEN status = 'active' THEN 'revealed' ELSE status END
     WHERE short_id = ?`
  ).run(shortId);
}

export function disableLink(shortId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE redemption_links SET status = 'disabled' WHERE short_id = ?`
  ).run(shortId);
}
