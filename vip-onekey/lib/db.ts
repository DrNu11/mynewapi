import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'vip.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cards (
  code            TEXT PRIMARY KEY,
  plan_days       INTEGER NOT NULL DEFAULT 30,
  status          TEXT NOT NULL DEFAULT 'unused',     -- unused | activated | expired
  created_at      INTEGER NOT NULL,
  activated_at    INTEGER,
  expires_at      INTEGER,
  used_user_id    INTEGER,
  used_email      TEXT,
  used_ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_status_expires ON cards (status, expires_at);

CREATE TABLE IF NOT EXISTS revert_tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  card_code       TEXT NOT NULL,
  user_id         INTEGER NOT NULL,
  email           TEXT NOT NULL,
  original_group  TEXT NOT NULL,
  target_group    TEXT NOT NULL,
  scheduled_at    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending | done | skipped | failed
  done_at         INTEGER,
  last_error      TEXT,
  FOREIGN KEY (card_code) REFERENCES cards(code)
);
CREATE INDEX IF NOT EXISTS idx_revert_status_time ON revert_tasks (status, scheduled_at);
`);

export interface Card {
  code: string;
  plan_days: number;
  status: 'unused' | 'activated' | 'expired';
  created_at: number;
  activated_at: number | null;
  expires_at: number | null;
  used_user_id: number | null;
  used_email: string | null;
  used_ip: string | null;
}

export interface RevertTask {
  id: number;
  card_code: string;
  user_id: number;
  email: string;
  original_group: string;
  target_group: string;
  scheduled_at: number;
  status: 'pending' | 'done' | 'skipped' | 'failed';
  done_at: number | null;
  last_error: string | null;
}

export function getCard(code: string): Card | undefined {
  return db.prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card | undefined;
}

export function insertCard(code: string, planDays = 30): void {
  db.prepare(
    'INSERT INTO cards (code, plan_days, status, created_at) VALUES (?, ?, ?, ?)',
  ).run(code, planDays, 'unused', Math.floor(Date.now() / 1000));
}

export function activateCard(
  code: string,
  userId: number,
  email: string,
  ip: string,
  expiresAt: number,
): void {
  db.prepare(
    `UPDATE cards
       SET status='activated', activated_at=?, expires_at=?, used_user_id=?, used_email=?, used_ip=?
     WHERE code=? AND status='unused'`,
  ).run(Math.floor(Date.now() / 1000), expiresAt, userId, email, ip, code);
}

export function markCardExpired(code: string): void {
  db.prepare(`UPDATE cards SET status='expired' WHERE code=? AND status='activated'`).run(code);
}

export function insertRevertTask(t: Omit<RevertTask, 'id' | 'status' | 'done_at' | 'last_error'>): number {
  const r = db.prepare(
    `INSERT INTO revert_tasks (card_code, user_id, email, original_group, target_group, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(t.card_code, t.user_id, t.email, t.original_group, t.target_group, t.scheduled_at);
  return Number(r.lastInsertRowid);
}

export function listDueRevertTasks(now: number): RevertTask[] {
  return db
    .prepare(
      `SELECT * FROM revert_tasks WHERE status='pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 100`,
    )
    .all(now) as RevertTask[];
}

export function finishRevertTask(id: number, status: 'done' | 'skipped' | 'failed', err?: string): void {
  db.prepare(
    `UPDATE revert_tasks SET status=?, done_at=?, last_error=? WHERE id=?`,
  ).run(status, Math.floor(Date.now() / 1000), err ?? null, id);
}

export default db;
