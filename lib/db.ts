import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'cards.db');

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const inst = new Database(DB_PATH);
  inst.pragma('journal_mode = WAL');
  inst.pragma('foreign_keys = ON');
  init(inst);
  _db = inst;
  return inst;
}

function init(inst: Database.Database) {
  inst.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL,
      plan_days INTEGER NOT NULL,
      category TEXT,
      rph INTEGER NOT NULL DEFAULT 0,
      pool TEXT,
      status TEXT NOT NULL DEFAULT 'unused',
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      expires_at INTEGER,
      claimed_at INTEGER,
      newapi_token_id INTEGER,
      newapi_token_key TEXT,
      activator_ip TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_code ON cards(code);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_cards_token_key ON cards(newapi_token_key);
    CREATE INDEX IF NOT EXISTS idx_cards_pool ON cards(pool);

    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sk_key TEXT NOT NULL,
      card_id INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      status INTEGER,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rl_sk_ts ON request_logs(sk_key, ts);
    CREATE INDEX IF NOT EXISTS idx_rl_card_ts ON request_logs(card_id, ts);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rate_limit (
      key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (key, window_start)
    );

    CREATE TABLE IF NOT EXISTS renewals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_card_id INTEGER NOT NULL,
      renewal_card_id INTEGER NOT NULL UNIQUE,
      renewed_at INTEGER NOT NULL,
      before_expires_at INTEGER NOT NULL,
      after_expires_at INTEGER NOT NULL,
      added_days REAL NOT NULL,
      newapi_token_id INTEGER NOT NULL,
      renewal_ip TEXT,
      FOREIGN KEY (original_card_id) REFERENCES cards(id),
      FOREIGN KEY (renewal_card_id) REFERENCES cards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_renewals_original ON renewals(original_card_id);
    CREATE INDEX IF NOT EXISTS idx_renewals_when ON renewals(renewed_at);
  `);
  // Migration: 给老库补缺失列
  const cols = inst.prepare('PRAGMA table_info(cards)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'claimed_at')) {
    inst.exec('ALTER TABLE cards ADD COLUMN claimed_at INTEGER');
  }
  if (!cols.some((c) => c.name === 'category')) {
    inst.exec('ALTER TABLE cards ADD COLUMN category TEXT');
  }
  if (!cols.some((c) => c.name === 'rph')) {
    inst.exec('ALTER TABLE cards ADD COLUMN rph INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'pool')) {
    inst.exec('ALTER TABLE cards ADD COLUMN pool TEXT');
    inst.exec('CREATE INDEX IF NOT EXISTS idx_cards_pool ON cards(pool)');
  }
  // request_logs 老库补 model 列(新建库已在上面 CREATE 时带上)
  const rlCols = inst.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>;
  if (!rlCols.some((c) => c.name === 'model')) {
    inst.exec('ALTER TABLE request_logs ADD COLUMN model TEXT');
  }
}

export interface Card {
  id: number;
  code: string;
  plan: string;
  plan_days: number;
  /** 'deepseek' | 'gpt' | 'claude' | null(老 NASSA- 卡密) */
  category: string | null;
  /** 每小时请求数上限(0 = 不限) */
  rph: number;
  /** 内部运营标签(号池/批次),仅管理员可见;NULL = 未归属 */
  pool: string | null;
  status: 'unused' | 'activating' | 'activated' | 'expired' | 'disabled';
  created_at: number;
  activated_at: number | null;
  expires_at: number | null;
  claimed_at: number | null;
  newapi_token_id: number | null;
  newapi_token_key: string | null;
  activator_ip: string | null;
  notes: string | null;
}

export function getCardByCode(code: string): Card | null {
  return (db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card) || null;
}

/**
 * 原子占领卡密(unused → activating).
 * 返回 true 表示占领成功,可继续调用 NewAPI;
 * 返回 false 表示卡密状态非 unused 或已被其他请求占领。
 *
 * 同时回收 claimed_at 早于 stale_threshold 秒前的 'activating' 状态(认为前次激活崩溃).
 */
export function claimCard(code: string, ip: string | null, staleSec = 60): boolean {
  const now = Math.floor(Date.now() / 1000);
  // 回收 stale claim
  db().prepare(
    `UPDATE cards SET status='unused', claimed_at=NULL WHERE status='activating' AND claimed_at IS NOT NULL AND claimed_at < ?`
  ).run(now - staleSec);
  // 原子占领
  const info = db().prepare(
    `UPDATE cards SET status='activating', claimed_at=?, activator_ip=? WHERE code=? AND status='unused'`
  ).run(now, ip, code);
  return info.changes === 1;
}

/** 占领后激活失败,回滚为 unused */
export function releaseCardClaim(code: string): void {
  db().prepare(
    `UPDATE cards SET status='unused', claimed_at=NULL, activator_ip=NULL WHERE code=? AND status='activating'`
  ).run(code);
}

export function insertCard(row: Omit<Card, 'id'>): number {
  const stmt = db().prepare(`
    INSERT INTO cards (code, plan, plan_days, category, rph, pool, status, created_at, activated_at, expires_at, newapi_token_id, newapi_token_key, activator_ip, notes)
    VALUES (@code, @plan, @plan_days, @category, @rph, @pool, @status, @created_at, @activated_at, @expires_at, @newapi_token_id, @newapi_token_key, @activator_ip, @notes)
  `);
  const info = stmt.run(row);
  return info.lastInsertRowid as number;
}

/** 列出所有已使用的 pool 名称(去重 + 字典序),admin 下拉框用 */
export function listPools(): string[] {
  const rows = db()
    .prepare(`SELECT DISTINCT pool FROM cards WHERE pool IS NOT NULL AND pool != '' ORDER BY pool ASC`)
    .all() as Array<{ pool: string }>;
  return rows.map((r) => r.pool);
}

/** 设置/清除单卡 pool;pool 传 null 或空串清除归属 */
export function setCardPool(code: string, pool: string | null): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  const v = pool && pool.trim() ? pool.trim().slice(0, 64) : null;
  db().prepare('UPDATE cards SET pool = ? WHERE code = ?').run(v, code);
  return getCardByCode(code);
}

/** 根据 sk-key 查卡 — /v1 代理路由鉴权用 */
export function getCardByTokenKey(skKey: string): Card | null {
  return (
    (db()
      .prepare('SELECT * FROM cards WHERE newapi_token_key = ?')
      .get(skKey) as Card) || null
  );
}

/** 近 N 秒内 sk-key 请求数(滑动窗口,保留备用;不再用于 RPH 限速) */
export function countRecentRequests(skKey: string, sinceSec: number): number {
  const since = Math.floor(Date.now() / 1000) - sinceSec;
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM request_logs WHERE sk_key = ? AND ts >= ?')
    .get(skKey, since) as { c: number };
  return row.c;
}

/**
 * 当前自然小时内 sk-key 请求数(整点固定窗口,限速用)
 *
 * 例:北京 13:42 调用 → 统计 13:00:00 ~ 13:59:59 的请求数
 * 14:00:00 整点自动重置归零,跟客户的"每小时 N 次"直觉对齐。
 *
 * 返回当前用量 + 下一次重置 unix 秒时间戳,供前端倒计时显示。
 */
export function countCurrentHourRequests(skKey: string): {
  used: number;
  hourStart: number;
  nextResetAt: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const hourStart = Math.floor(now / 3600) * 3600;
  const nextResetAt = hourStart + 3600;
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM request_logs WHERE sk_key = ? AND ts >= ?')
    .get(skKey, hourStart) as { c: number };
  return { used: row.c, hourStart, nextResetAt };
}

/** 记录一次 sk-key 调用 */
export function recordRequest(
  skKey: string,
  cardId: number,
  status?: number,
  model?: string | null
): void {
  db().prepare(
    'INSERT INTO request_logs (sk_key, card_id, ts, status, model) VALUES (?, ?, ?, ?, ?)'
  ).run(skKey, cardId, Math.floor(Date.now() / 1000), status ?? null, model ?? null);
}

/** 当前自然小时内 sk-key 调用过的模型分布(按次数倒序) */
export function getModelsUsedCurrentHour(skKey: string): Array<{ model: string; count: number }> {
  const now = Math.floor(Date.now() / 1000);
  const hourStart = Math.floor(now / 3600) * 3600;
  const rows = db()
    .prepare(
      `SELECT COALESCE(model, '(未知)') AS model, COUNT(*) AS c
       FROM request_logs
       WHERE sk_key = ? AND ts >= ? AND model IS NOT NULL
       GROUP BY model
       ORDER BY c DESC`
    )
    .all(skKey, hourStart) as Array<{ model: string; c: number }>;
  return rows.map((r) => ({ model: r.model, count: r.c }));
}

/** 某 sk-key 的总请求统计(含成功/失败,用于总览看板) */
export function getTotalRequestStats(skKey: string): {
  total: number;
  success: number;
  failed: number;
} {
  const row = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IS NULL OR status < 400 THEN 1 ELSE 0 END) AS success,
         SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS failed
       FROM request_logs WHERE sk_key = ?`
    )
    .get(skKey) as { total: number; success: number; failed: number };
  return {
    total: row.total || 0,
    success: row.success || 0,
    failed: row.failed || 0,
  };
}

/** 近 N 天每日请求数(按本地 YYYY-MM-DD 分组,按日期升序返回,补零确保连续) */
export function getDailyCountsLastNDays(
  skKey: string,
  days: number
): Array<{ date: string; count: number }> {
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(ts, 'unixepoch', 'localtime')) AS date,
              COUNT(*) AS c
       FROM request_logs
       WHERE sk_key = ? AND ts >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(skKey, since) as Array<{ date: string; c: number }>;
  const byDate: Record<string, number> = {};
  for (const r of rows) byDate[r.date] = r.c;
  // 补零:从 days-1 天前到今天,确保日期连续
  const result: Array<{ date: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    result.push({ date: key, count: byDate[key] || 0 });
  }
  return result;
}

/**
 * 近 N 天每日请求数 + 按模型分层(stacked 柱状图用)
 * 返回 [{date, total, by_model: {model: count}}],日期升序连续(补 0)
 */
export function getDailyCountsByModelLastNDays(
  skKey: string,
  days: number
): Array<{ date: string; total: number; by_model: Record<string, number> }> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(ts, 'unixepoch', 'localtime')) AS date,
              COALESCE(model, '(未知)') AS model,
              COUNT(*) AS c
       FROM request_logs
       WHERE sk_key = ? AND ts >= ? AND model IS NOT NULL
       GROUP BY date, model
       ORDER BY date ASC, c DESC`
    )
    .all(skKey, since) as Array<{ date: string; model: string; c: number }>;

  // 聚合到 date → by_model
  const byDate: Record<string, { total: number; by_model: Record<string, number> }> = {};
  for (const r of rows) {
    if (!byDate[r.date]) byDate[r.date] = { total: 0, by_model: {} };
    byDate[r.date].by_model[r.model] = (byDate[r.date].by_model[r.model] || 0) + r.c;
    byDate[r.date].total += r.c;
  }

  // 补零:连续 days 天
  const result: Array<{ date: string; total: number; by_model: Record<string, number> }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    const entry = byDate[key];
    result.push({
      date: key,
      total: entry?.total ?? 0,
      by_model: entry?.by_model ?? {},
    });
  }
  return result;
}

/** 近 N 天模型调用 top 榜(按次数倒序) */
export function getTopModelsLastNDays(
  skKey: string,
  days: number,
  limit = 5
): Array<{ model: string; count: number }> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = db()
    .prepare(
      `SELECT COALESCE(model, '(未知)') AS model, COUNT(*) AS c
       FROM request_logs
       WHERE sk_key = ? AND ts >= ? AND model IS NOT NULL
       GROUP BY model
       ORDER BY c DESC
       LIMIT ?`
    )
    .all(skKey, since, limit) as Array<{ model: string; c: number }>;
  return rows.map((r) => ({ model: r.model, count: r.c }));
}

/** 清理 N 天前的旧请求日志(定期调用,避免库变大) */
export function pruneOldRequests(daysToKeep = 7): number {
  const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 86400;
  const r = db().prepare('DELETE FROM request_logs WHERE ts < ?').run(cutoff);
  return r.changes as number;
}

/** 批量查多张卡在近 N 秒内的请求数(admin 列表用),返回 cardId -> count */
export function getRequestCountsByCardIds(
  cardIds: number[],
  sinceSec: number
): Record<number, number> {
  if (cardIds.length === 0) return {};
  const since = Math.floor(Date.now() / 1000) - sinceSec;
  const placeholders = cardIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT card_id, COUNT(*) as c FROM request_logs WHERE ts >= ? AND card_id IN (${placeholders}) GROUP BY card_id`
    )
    .all(since, ...cardIds) as Array<{ card_id: number; c: number }>;
  const m: Record<number, number> = {};
  for (const r of rows) m[r.card_id] = r.c;
  return m;
}

/**
 * 切换卡密状态(admin 用):
 *   - 'disable': 任何状态 → 'disabled' (主要用于已激活的卡, 配合 NewAPI token 禁用一起用)
 *   - 'enable':  'disabled' → 恢复到 'activated' 或 'unused' (按 newapi_token_key 是否存在)
 *
 * 返回更新后的 Card; 找不到返回 null。
 */
export function setCardStatus(code: string, action: 'disable' | 'enable'): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  if (action === 'disable') {
    db().prepare(`UPDATE cards SET status='disabled' WHERE code=?`).run(code);
  } else {
    // enable: 已激活的卡 → 'activated'; 没激活过的卡 → 'unused'
    const restored = card.newapi_token_key ? 'activated' : 'unused';
    db().prepare(`UPDATE cards SET status=? WHERE code=?`).run(restored, code);
  }
  return getCardByCode(code);
}

/** 把已占领(activating)的卡密 finalize 成 activated;expiresAt=null 表示永不过期 */
export function activateCard(
  code: string,
  tokenId: number,
  tokenKey: string,
  expiresAt: number | null
): void {
  db().prepare(`
    UPDATE cards
    SET status = 'activated',
        activated_at = ?,
        expires_at = ?,
        newapi_token_id = ?,
        newapi_token_key = ?,
        claimed_at = NULL
    WHERE code = ? AND status = 'activating'
  `).run(Math.floor(Date.now() / 1000), expiresAt, tokenId, tokenKey, code);
}

export function listCards(opts: { status?: string; plan?: string; pool?: string; q?: string; limit?: number; offset?: number } = {}): Card[] {
  const { status, plan, pool, q, limit = 100, offset = 0 } = opts;
  const where: string[] = [];
  const params: any[] = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (plan) { where.push('plan = ?'); params.push(plan); }
  if (pool === '__none__') {
    where.push('(pool IS NULL OR pool = "")');
  } else if (pool) {
    where.push('pool = ?'); params.push(pool);
  }
  if (q) {
    // 模糊搜索: 卡密 / 备注 / NewAPI sk-key
    where.push('(code LIKE ? OR notes LIKE ? OR newapi_token_key LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM cards ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
  return db().prepare(sql).all(...params, limit, offset) as Card[];
}

export interface CardStats {
  total: number;
  unused: number;
  activated: number;
  expired: number;
  by_plan: Record<string, number>;
}

export function getStats(): CardStats {
  const rows = db().prepare('SELECT status, plan, COUNT(*) as c FROM cards GROUP BY status, plan').all() as Array<{ status: string; plan: string; c: number }>;
  const stats: CardStats = { total: 0, unused: 0, activated: 0, expired: 0, by_plan: {} };
  for (const r of rows) {
    stats.total += r.c;
    // 'activating' 算作 'unused' 对外展示,内部短暂中间态
    if (r.status === 'unused' || r.status === 'activating') stats.unused += r.c;
    else if (r.status === 'activated') stats.activated += r.c;
    else if (r.status === 'expired') stats.expired += r.c;
    stats.by_plan[r.plan] = (stats.by_plan[r.plan] || 0) + r.c;
  }
  return stats;
}

/** 检查并标记到期的卡密(惰性更新,在每次激活/列表时调用) */
export function markExpiredCards(): number {
  const now = Math.floor(Date.now() / 1000);
  const info = db().prepare(`UPDATE cards SET status = 'expired' WHERE status = 'activated' AND expires_at IS NOT NULL AND expires_at <= ?`).run(now);
  return info.changes as number;
}

// =============================== 续费 (renewals) ===============================

export interface Renewal {
  id: number;
  original_card_id: number;
  renewal_card_id: number;
  renewed_at: number;
  before_expires_at: number;
  after_expires_at: number;
  added_days: number;
  newapi_token_id: number;
  renewal_ip: string | null;
}

/**
 * 续费 — 必须事务执行,确保如下操作要么全部成功要么全部失败:
 *   1. INSERT renewals(...)  审计链 (UNIQUE renewal_card_id 防同卡续两次)
 *   2. UPDATE cards SET expires_at=after_expires_at WHERE id = original_card_id
 *   3. UPDATE cards SET status='activated', activated_at=now,
 *                       expires_at=after_expires_at,
 *                       newapi_token_id=<orig token>, newapi_token_key=<orig key>,
 *                       activator_ip=<renewal_ip>, claimed_at=NULL
 *      WHERE id = renewal_card_id AND status='activating'
 *
 * 调用前提:
 *   - renewal_card 已被 claimCard 占领为 'activating'
 *   - NewAPI token 已经成功改 expired_time = afterExpiresAt
 *
 * @throws 若 UNIQUE 冲突 (并发同时续费同一张) 或事务任何步骤失败
 */
export function applyRenewal(args: {
  originalCardId: number;
  renewalCardId: number;
  beforeExpiresAt: number;
  afterExpiresAt: number;
  addedDays: number;
  newapiTokenId: number;
  newapiTokenKey: string;
  renewalIp: string | null;
}): number {
  const now = Math.floor(Date.now() / 1000);
  const tx = db().transaction(() => {
    const r = db().prepare(`
      INSERT INTO renewals (original_card_id, renewal_card_id, renewed_at,
                            before_expires_at, after_expires_at, added_days,
                            newapi_token_id, renewal_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      args.originalCardId, args.renewalCardId, now,
      args.beforeExpiresAt, args.afterExpiresAt, args.addedDays,
      args.newapiTokenId, args.renewalIp,
    );
    if (r.changes !== 1) throw new Error('renewal insert failed');

    const u1 = db().prepare(
      `UPDATE cards SET expires_at = ?, status = 'activated' WHERE id = ?`,
    ).run(args.afterExpiresAt, args.originalCardId);
    if (u1.changes !== 1) throw new Error('original card update failed');

    const u2 = db().prepare(`
      UPDATE cards
      SET status = 'activated',
          activated_at = ?,
          expires_at = ?,
          newapi_token_id = ?,
          newapi_token_key = ?,
          activator_ip = ?,
          claimed_at = NULL
      WHERE id = ? AND status = 'activating'
    `).run(now, args.afterExpiresAt, args.newapiTokenId, args.newapiTokenKey,
      args.renewalIp, args.renewalCardId);
    if (u2.changes !== 1) throw new Error('renewal card finalize failed (state changed?)');

    return Number(r.lastInsertRowid);
  });
  return tx() as number;
}

/** 查某张续费卡是否已经被用过 (UNIQUE 约束已经保证,这是显式查询用) */
export function getRenewalByRenewalCardId(renewalCardId: number): Renewal | null {
  return (db()
    .prepare('SELECT * FROM renewals WHERE renewal_card_id = ?')
    .get(renewalCardId) as Renewal) || null;
}

/** 列出某原卡的所有续费记录 (按时间倒序) */
export function listRenewalsForOriginal(originalCardId: number): Renewal[] {
  return db()
    .prepare('SELECT * FROM renewals WHERE original_card_id = ? ORDER BY renewed_at DESC')
    .all(originalCardId) as Renewal[];
}

// ===============================================================================

/** 简单的 IP 速率限制:每分钟最多 N 次 */
export function checkRateLimit(key: string, max: number, windowSec = 60): boolean {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSec) * windowSec;
  const stmt = db().prepare('SELECT count FROM rate_limit WHERE key = ? AND window_start = ?');
  const row = stmt.get(key, windowStart) as { count: number } | undefined;
  if (row && row.count >= max) return false;
  if (row) {
    db().prepare('UPDATE rate_limit SET count = count + 1 WHERE key = ? AND window_start = ?').run(key, windowStart);
  } else {
    // 顺手清理 1 小时前的窗口
    db().prepare('DELETE FROM rate_limit WHERE window_start < ?').run(windowStart - 3600);
    db().prepare('INSERT INTO rate_limit (key, window_start, count) VALUES (?, ?, 1)').run(key, windowStart);
  }
  return true;
}
