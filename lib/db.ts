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
      newapi_user_id INTEGER,
      newapi_token_id INTEGER,
      newapi_token_key TEXT,
      activator_ip TEXT,
      disable_reason TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_code ON cards(code);
    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_cards_token_key ON cards(newapi_token_key);

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

    CREATE TABLE IF NOT EXISTS video_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT UNIQUE NOT NULL,
      card_id INTEGER NOT NULL,
      sk_key TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt TEXT NOT NULL,
      duration INTEGER NOT NULL,
      resolution TEXT NOT NULL,
      status TEXT NOT NULL,
      file_id TEXT,
      download_url TEXT,
      error_message TEXT,
      account_index INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_video_tasks_task_id ON video_tasks(task_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_card_id ON video_tasks(card_id);
    CREATE INDEX IF NOT EXISTS idx_video_tasks_sk_key ON video_tasks(sk_key);
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
  }
  if (!cols.some((c) => c.name === 'newapi_user_id')) {
    inst.exec('ALTER TABLE cards ADD COLUMN newapi_user_id INTEGER');
  }
  if (!cols.some((c) => c.name === 'disable_reason')) {
    inst.exec('ALTER TABLE cards ADD COLUMN disable_reason TEXT');
  }
  inst.exec('CREATE INDEX IF NOT EXISTS idx_cards_newapi_user_id ON cards(newapi_user_id)');
  inst.exec('CREATE INDEX IF NOT EXISTS idx_cards_pool ON cards(pool)');
  // request_logs 老库补 model 列(新建库已在上面 CREATE 时带上)
  const rlCols = inst.prepare('PRAGMA table_info(request_logs)').all() as Array<{ name: string }>;
  if (!rlCols.some((c) => c.name === 'model')) {
    inst.exec('ALTER TABLE request_logs ADD COLUMN model TEXT');
  }
  // video_quota: 单卡视频生成基础体验次数(默认 1, 0 = 不限)
  if (!cols.some((c) => c.name === 'video_quota')) {
    inst.exec('ALTER TABLE cards ADD COLUMN video_quota INTEGER NOT NULL DEFAULT 1');
  }
  // video_bonus_quota: 邀请奖励获得的额外视频次数
  if (!cols.some((c) => c.name === 'video_bonus_quota')) {
    inst.exec('ALTER TABLE cards ADD COLUMN video_bonus_quota INTEGER NOT NULL DEFAULT 0');
  }
  // video_tasks 增量迁移
  const vtCols = inst.prepare('PRAGMA table_info(video_tasks)').all() as Array<{ name: string }>;
  if (!vtCols.some((c) => c.name === 'account_index')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN account_index INTEGER NOT NULL DEFAULT 0');
  }
  if (!vtCols.some((c) => c.name === 'quota_source')) {
    inst.exec("ALTER TABLE video_tasks ADD COLUMN quota_source TEXT NOT NULL DEFAULT 'base'");
  }
  if (!vtCols.some((c) => c.name === 'reservation_id')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN reservation_id INTEGER');
  }
  if (!vtCols.some((c) => c.name === 'operation_id')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN operation_id TEXT');
  }
  if (!vtCols.some((c) => c.name === 'last_query_error')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN last_query_error TEXT');
  }
  if (!vtCols.some((c) => c.name === 'query_error_count')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN query_error_count INTEGER NOT NULL DEFAULT 0');
  }
  if (!vtCols.some((c) => c.name === 'last_queried_at')) {
    inst.exec('ALTER TABLE video_tasks ADD COLUMN last_queried_at INTEGER');
  }
  inst.exec('CREATE UNIQUE INDEX IF NOT EXISTS uk_video_tasks_operation_id ON video_tasks(operation_id) WHERE operation_id IS NOT NULL');

  // video_create_operations: 请求级幂等
  inst.exec(`CREATE TABLE IF NOT EXISTS video_create_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT UNIQUE NOT NULL,
    card_id INTEGER NOT NULL,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    video_task_id INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (card_id) REFERENCES cards(id),
    FOREIGN KEY (video_task_id) REFERENCES video_tasks(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_vco_card_status ON video_create_operations(card_id, status, created_at)');

  // video_quota_reservations: 额度预占
  inst.exec(`CREATE TABLE IF NOT EXISTS video_quota_reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id TEXT NOT NULL,
    attempt_id TEXT UNIQUE NOT NULL,
    card_id INTEGER NOT NULL,
    quota_source TEXT NOT NULL,
    account_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    committed_at INTEGER,
    released_at INTEGER,
    release_reason TEXT,
    FOREIGN KEY (card_id) REFERENCES cards(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_vqr_card_source_status ON video_quota_reservations(card_id, quota_source, status, expires_at)');
  inst.exec('CREATE INDEX IF NOT EXISTS idx_vqr_account_status ON video_quota_reservations(account_index, status, expires_at)');
  inst.exec('CREATE INDEX IF NOT EXISTS idx_vqr_operation ON video_quota_reservations(operation_id, created_at)');
  inst.exec("CREATE UNIQUE INDEX IF NOT EXISTS uk_vqr_one_active_attempt ON video_quota_reservations(operation_id) WHERE status IN ('reserved', 'uncertain', 'committed')");

  // ---- 邀请奖励系统 ----

  inst.exec(`CREATE TABLE IF NOT EXISTS invite_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code TEXT UNIQUE NOT NULL,
    inviter_card_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    creator_ip_hash TEXT,
    creator_device_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (inviter_card_id) REFERENCES cards(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_links_code ON invite_links(invite_code)');

  inst.exec(`CREATE TABLE IF NOT EXISTS invite_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_token_hash TEXT UNIQUE NOT NULL,
    invite_link_id INTEGER NOT NULL,
    invitee_ip_hash TEXT,
    invitee_device_hash TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (invite_link_id) REFERENCES invite_links(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_visits_link_created ON invite_visits(invite_link_id, created_at)');
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_visits_expiry ON invite_visits(expires_at)');

  inst.exec(`CREATE TABLE IF NOT EXISTS invite_attributions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_visit_id INTEGER NOT NULL,
    invite_link_id INTEGER NOT NULL,
    inviter_card_id INTEGER NOT NULL,
    invitee_card_id INTEGER NOT NULL,
    video_task_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    outcome TEXT,
    risk_flags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (invite_visit_id) REFERENCES invite_visits(id),
    FOREIGN KEY (invite_link_id) REFERENCES invite_links(id),
    FOREIGN KEY (inviter_card_id) REFERENCES cards(id),
    FOREIGN KEY (invitee_card_id) REFERENCES cards(id),
    FOREIGN KEY (video_task_id) REFERENCES video_tasks(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_attr_invitee_status ON invite_attributions(invitee_card_id, status)');

  inst.exec(`CREATE TABLE IF NOT EXISTS invite_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attribution_id INTEGER NOT NULL UNIQUE,
    invite_link_id INTEGER NOT NULL,
    inviter_card_id INTEGER NOT NULL,
    invitee_card_id INTEGER NOT NULL UNIQUE,
    qualifying_video_task_id INTEGER NOT NULL UNIQUE,
    reward_status TEXT NOT NULL,
    business_date TEXT NOT NULL,
    risk_flags TEXT,
    rejected_reason TEXT,
    created_at INTEGER NOT NULL,
    granted_at INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (attribution_id) REFERENCES invite_attributions(id),
    FOREIGN KEY (invite_link_id) REFERENCES invite_links(id),
    FOREIGN KEY (inviter_card_id) REFERENCES cards(id),
    FOREIGN KEY (invitee_card_id) REFERENCES cards(id),
    FOREIGN KEY (qualifying_video_task_id) REFERENCES video_tasks(id)
  )`);
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_redemptions_inviter_day ON invite_redemptions(inviter_card_id, business_date, reward_status)');

  inst.exec(`CREATE TABLE IF NOT EXISTS invite_reward_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    redemption_id INTEGER NOT NULL,
    inviter_card_id INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    delta INTEGER NOT NULL,
    business_date TEXT NOT NULL,
    related_ledger_id INTEGER,
    reason TEXT,
    operator TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (redemption_id) REFERENCES invite_redemptions(id),
    FOREIGN KEY (inviter_card_id) REFERENCES cards(id),
    FOREIGN KEY (related_ledger_id) REFERENCES invite_reward_ledger(id)
  )`);
  inst.exec('CREATE UNIQUE INDEX IF NOT EXISTS uk_invite_ledger_one_grant ON invite_reward_ledger(redemption_id) WHERE entry_type = \'grant\'');
  inst.exec('CREATE UNIQUE INDEX IF NOT EXISTS uk_invite_ledger_one_reverse ON invite_reward_ledger(related_ledger_id) WHERE entry_type = \'reverse\'');
  inst.exec('CREATE INDEX IF NOT EXISTS idx_invite_ledger_inviter_day ON invite_reward_ledger(inviter_card_id, business_date, entry_type)');
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
  /** 视频生成基础体验次数(默认 1, 0 = 不限) */
  video_quota: number;
  /** 邀请奖励获得的额外视频次数 */
  video_bonus_quota: number;
  /** 内部运营标签(号池/批次),仅管理员可见;NULL = 未归属 */
  pool: string | null;
  status: 'unused' | 'activating' | 'activated' | 'expired' | 'disabled';
  created_at: number;
  activated_at: number | null;
  expires_at: number | null;
  claimed_at: number | null;
  /** 激活时把 NewAPI token 创建到这个用户 ID 下;NULL = 使用默认 NEWAPI_USER_ID */
  newapi_user_id: number | null;
  newapi_token_id: number | null;
  newapi_token_key: string | null;
  activator_ip: string | null;
  disable_reason: string | null;
  notes: string | null;
}

export interface VideoTask {
  id: number;
  task_id: string;
  card_id: number;
  sk_key: string;
  model: string;
  prompt: string;
  duration: number;
  resolution: string;
  status: string;
  file_id: string | null;
  download_url: string | null;
  error_message: string | null;
  account_index: number;
  quota_source: string;
  reservation_id: number | null;
  operation_id: string | null;
  last_query_error: string | null;
  query_error_count: number;
  last_queried_at: number | null;
  created_at: number;
  updated_at: number;
}

export function getCardByCode(code: string): Card | null {
  return (db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card) || null;
}

export function countActivatedCardsForTokenPlan(args: {
  tokenId: number;
  tokenKey?: string | null;
  category: string;
  plan: string;
}): number {
  const tokenWhere = args.tokenKey
    ? '(newapi_token_id = ? OR newapi_token_key = ?)'
    : 'newapi_token_id = ?';
  const tokenParams = args.tokenKey ? [args.tokenId, args.tokenKey] : [args.tokenId];
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM cards
       WHERE ${tokenWhere}
         AND category = ?
         AND plan = ?
         AND status = 'activated'`,
    )
    .get(...tokenParams, args.category, args.plan) as { c: number } | undefined;
  return Number(row?.c || 0);
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
    INSERT INTO cards (code, plan, plan_days, category, rph, video_quota, pool, status, created_at, activated_at, expires_at, newapi_user_id, newapi_token_id, newapi_token_key, activator_ip, disable_reason, notes)
    VALUES (@code, @plan, @plan_days, @category, @rph, @video_quota, @pool, @status, @created_at, @activated_at, @expires_at, @newapi_user_id, @newapi_token_id, @newapi_token_key, @activator_ip, @disable_reason, @notes)
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

/** 设置/清除单卡绑定的 NewAPI 用户 ID;已激活卡只改变本地标注,不会迁移历史 token。 */
export function setCardNewApiUserId(code: string, userId: number | null): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  db().prepare('UPDATE cards SET newapi_user_id = ? WHERE code = ?').run(userId, code);
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

export function insertVideoTask(row: Omit<VideoTask, 'id' | 'created_at' | 'updated_at'>): VideoTask {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(
    `INSERT INTO video_tasks (
      task_id, card_id, sk_key, model, prompt, duration, resolution, status,
      file_id, download_url, error_message, account_index, quota_source, reservation_id, operation_id,
      created_at, updated_at
    ) VALUES (
      @task_id, @card_id, @sk_key, @model, @prompt, @duration, @resolution, @status,
      @file_id, @download_url, @error_message, @account_index, @quota_source, @reservation_id, @operation_id,
      @created_at, @updated_at
    )`
  ).run({ ...row, created_at: now, updated_at: now });
  return getVideoTaskByTaskId(row.task_id) as VideoTask;
}

export function getVideoTaskByTaskId(taskId: string): VideoTask | null {
  return (
    (db().prepare('SELECT * FROM video_tasks WHERE task_id = ?').get(taskId) as VideoTask) || null
  );
}

export function updateVideoTask(
  taskId: string,
  patch: Partial<Pick<VideoTask, 'status' | 'file_id' | 'download_url' | 'error_message' | 'last_query_error' | 'query_error_count' | 'last_queried_at'>>
): VideoTask | null {
  const task = getVideoTaskByTaskId(taskId);
  if (!task) return null;
  const next = {
    status: patch.status ?? task.status,
    file_id: 'file_id' in patch ? (patch.file_id ?? null) : task.file_id,
    download_url: 'download_url' in patch ? (patch.download_url ?? null) : task.download_url,
    error_message: 'error_message' in patch ? (patch.error_message ?? null) : task.error_message,
    last_query_error: 'last_query_error' in patch ? (patch.last_query_error ?? null) : task.last_query_error,
    query_error_count: patch.query_error_count ?? task.query_error_count,
    last_queried_at: 'last_queried_at' in patch ? (patch.last_queried_at ?? null) : task.last_queried_at,
    updated_at: Math.floor(Date.now() / 1000),
    task_id: taskId,
  };
  db().prepare(
    `UPDATE video_tasks
     SET status = @status,
         file_id = @file_id,
         download_url = @download_url,
         error_message = @error_message,
         last_query_error = @last_query_error,
         query_error_count = @query_error_count,
         last_queried_at = @last_queried_at,
         updated_at = @updated_at
     WHERE task_id = @task_id`
  ).run(next);
  return getVideoTaskByTaskId(taskId);
}

/** 北京时区(UTC+8)当天 0 点 unix 秒时间戳 */
export function todayStartSeconds(): number {
  const now = Math.floor(Date.now() / 1000);
  const offset = 8 * 3600;
  return Math.floor((now + offset) / 86400) * 86400 - offset;
}

/** 北京时区(UTC+8)当天日期字符串 YYYY-MM-DD */
export function currentBusinessDate(): string {
  return new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** 查询某卡密已使用的视频生成次数 */
export function getVideoQuotaUsed(cardId: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM video_tasks WHERE card_id = ?')
    .get(cardId) as { c: number };
  return row?.c || 0;
}

/** 今日全局视频生成次数(所有账号合计) */
export function getRecentVideoCount(): number {
  const since = todayStartSeconds();
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM video_tasks WHERE created_at >= ?')
    .get(since) as { c: number };
  return row?.c || 0;
}

/** 今日指定账号的视频生成次数 */
export function getRecentVideoCountByAccount(accountIndex: number): number {
  const since = todayStartSeconds();
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM video_tasks WHERE created_at >= ? AND account_index = ?')
    .get(since, accountIndex) as { c: number };
  return row?.c || 0;
}

/** 今日各账号的视频生成次数 */
export function getAccountVideoCounts(): Record<number, number> {
  const since = todayStartSeconds();
  const rows = db()
    .prepare('SELECT account_index, COUNT(*) as c FROM video_tasks WHERE created_at >= ? GROUP BY account_index')
    .all(since) as Array<{ account_index: number; c: number }>;
  const result: Record<number, number> = {};
  for (const r of rows) result[r.account_index] = r.c;
  return result;
}

// ---- video quota by source ----

/** 按 quota_source 统计某卡的视频任务数 */
export function getVideoQuotaUsedBySource(cardId: number, source: string): number {
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM video_tasks WHERE card_id = ? AND quota_source = ?')
    .get(cardId, source) as { c: number };
  return row?.c || 0;
}

/** 按 quota_source 统计有效预占数(reserved/uncertain) */
export function countReservedBySource(cardId: number, source: string, now: number): number {
  const row = db()
    .prepare(`SELECT COUNT(*) as c FROM video_quota_reservations
      WHERE card_id = ? AND quota_source = ? AND status IN ('reserved', 'uncertain')
      AND (status = 'uncertain' OR expires_at > ?)`)
    .get(cardId, source, now) as { c: number };
  return row?.c || 0;
}

/** 按账号统计当日用量(含已落库任务 + 有效预占) */
export function countAccountUsageToday(accountIndex: number, since: number, now: number): number {
  const tasks = (db()
    .prepare('SELECT COUNT(*) as c FROM video_tasks WHERE account_index = ? AND created_at >= ?')
    .get(accountIndex, since) as { c: number }).c;
  const reservations = (db()
    .prepare(`SELECT COUNT(*) as c FROM video_quota_reservations
      WHERE account_index = ? AND status IN ('reserved', 'uncertain') AND expires_at > ?`)
    .get(accountIndex, now) as { c: number }).c;
  return tasks + reservations;
}

// ---- video create operations ----

export interface VideoCreateOperation {
  id: number;
  operation_id: string;
  card_id: number;
  payload_hash: string;
  status: string;
  video_task_id: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export function getVideoCreateOperation(opId: string): VideoCreateOperation | null {
  return (db().prepare('SELECT * FROM video_create_operations WHERE operation_id = ?').get(opId) as VideoCreateOperation) || null;
}

export function insertVideoCreateOperation(row: { operation_id: string; card_id: number; payload_hash: string }): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare('INSERT INTO video_create_operations (operation_id, card_id, payload_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.operation_id, row.card_id, row.payload_hash, 'pending', now, now);
}

export function updateVideoCreateOperation(opId: string, patch: { status?: string; video_task_id?: number | null; last_error?: string | null }): void {
  const now = Math.floor(Date.now() / 1000);
  const op = getVideoCreateOperation(opId);
  if (!op) return;
  db().prepare('UPDATE video_create_operations SET status = ?, video_task_id = ?, last_error = ?, updated_at = ? WHERE operation_id = ?')
    .run(patch.status ?? op.status, 'video_task_id' in patch ? (patch.video_task_id ?? null) : op.video_task_id, 'last_error' in patch ? (patch.last_error ?? null) : op.last_error, now, opId);
}

// ---- video quota reservations ----

export interface VideoQuotaReservation {
  id: number;
  operation_id: string;
  attempt_id: string;
  card_id: number;
  quota_source: string;
  account_index: number;
  status: string;
  created_at: number;
  expires_at: number;
  committed_at: number | null;
  released_at: number | null;
  release_reason: string | null;
}

export function insertReservation(row: {
  operation_id: string; attempt_id: string; card_id: number;
  quota_source: string; account_index: number; status: string; expires_at: number;
}): number {
  const now = Math.floor(Date.now() / 1000);
  const info = db().prepare(`INSERT INTO video_quota_reservations
    (operation_id, attempt_id, card_id, quota_source, account_index, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.operation_id, row.attempt_id, row.card_id, row.quota_source, row.account_index, row.status, now, row.expires_at);
  return info.lastInsertRowid as number;
}

export function releaseReservation(attemptId: string, reason: string): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare("UPDATE video_quota_reservations SET status = 'released', released_at = ?, release_reason = ? WHERE attempt_id = ? AND status = 'reserved'")
    .run(now, reason, attemptId);
}

export function commitReservation(reservationId: number): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare("UPDATE video_quota_reservations SET status = 'committed', committed_at = ? WHERE id = ?")
    .run(now, reservationId);
}

export function markReservationUncertain(attemptId: string): void {
  db().prepare("UPDATE video_quota_reservations SET status = 'uncertain' WHERE attempt_id = ?")
    .run(attemptId);
}

export function releaseExpiredReservations(now: number): number {
  const info = db().prepare("UPDATE video_quota_reservations SET status = 'released', released_at = ?, release_reason = 'expired' WHERE status = 'reserved' AND expires_at <= ?")
    .run(now, now);
  return info.changes;
}

/** SELECT ... FOR UPDATE 模拟: IMMEDIATE 事务内先读,持有写锁 */
export function getCardForUpdate(cardId: number): Card | null {
  return (db().prepare('SELECT * FROM cards WHERE id = ?').get(cardId) as Card) || null;
}

/** 查出所有需同步的视频任务(Submitted / Processing / Success 但无下载地址) */
export function getStaleVideoTasks(limit = 50): VideoTask[] {
  return db()
    .prepare(`SELECT * FROM video_tasks WHERE status IN ('Submitted', 'Processing')
      OR (status = 'Success' AND download_url IS NULL)
      ORDER BY updated_at ASC LIMIT ?`)
    .all(limit) as VideoTask[];
}

/** 查出所有 uncertain 操作(供监控) */
export function getUncertainOperations(): VideoCreateOperation[] {
  return db()
    .prepare("SELECT * FROM video_create_operations WHERE status = 'uncertain' ORDER BY created_at DESC")
    .all() as VideoCreateOperation[];
}

/** 按 operation_id 查 video_task */
export function getVideoTaskByOperationId(opId: string): VideoTask | null {
  return (db().prepare('SELECT * FROM video_tasks WHERE operation_id = ?').get(opId) as VideoTask) || null;
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

export function reserveCurrentHourRequest(
  skKey: string,
  cardId: number,
  rph: number,
  model?: string | null
): { allowed: boolean; used: number; nextResetAt: number; logId?: number } {
  const now = Math.floor(Date.now() / 1000);
  const hourStart = Math.floor(now / 3600) * 3600;
  const nextResetAt = hourStart + 3600;
  const tx = db().transaction(() => {
    const row = db()
      .prepare('SELECT COUNT(*) as c FROM request_logs WHERE sk_key = ? AND ts >= ?')
      .get(skKey, hourStart) as { c: number };
    const used = row.c || 0;
    if (rph > 0 && used >= rph) {
      return { allowed: false, used, nextResetAt };
    }
    const info = db()
      .prepare('INSERT INTO request_logs (sk_key, card_id, ts, status, model) VALUES (?, ?, ?, ?, ?)')
      .run(skKey, cardId, now, 0, model ?? null);
    return {
      allowed: true,
      used: used + 1,
      nextResetAt,
      logId: Number(info.lastInsertRowid),
    };
  });
  return tx() as { allowed: boolean; used: number; nextResetAt: number; logId?: number };
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

export function updateRequestLogStatus(logId: number, status?: number, model?: string | null): void {
  db().prepare('UPDATE request_logs SET status = ?, model = COALESCE(?, model) WHERE id = ?')
    .run(status ?? null, model ?? null, logId);
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

/** 批量查多张卡当前自然小时请求数(admin 列表用),口径与 RPH 限速一致。 */
export function getCurrentHourRequestCountsByCardIds(cardIds: number[]): Record<number, number> {
  if (cardIds.length === 0) return {};
  const now = Math.floor(Date.now() / 1000);
  const hourStart = Math.floor(now / 3600) * 3600;
  const placeholders = cardIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT card_id, COUNT(*) as c FROM request_logs WHERE ts >= ? AND card_id IN (${placeholders}) GROUP BY card_id`
    )
    .all(hourStart, ...cardIds) as Array<{ card_id: number; c: number }>;
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
export function setCardStatus(code: string, action: 'disable' | 'enable', reason?: string | null): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  if (action === 'disable') {
    const v = reason && reason.trim() ? reason.trim().slice(0, 500) : null;
    db().prepare(`UPDATE cards SET status='disabled', disable_reason=? WHERE code=?`).run(v, code);
  } else {
    // enable: 已激活的卡 → 'activated'; 没激活过的卡 → 'unused'
    const restored = card.newapi_token_key ? 'activated' : 'unused';
    db().prepare(`UPDATE cards SET status=?, disable_reason=NULL WHERE code=?`).run(restored, code);
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
    // 模糊搜索: 卡密 / 备注 / NewAPI sk-key / NewAPI 用户 ID
    where.push('(code LIKE ? OR notes LIKE ? OR newapi_token_key LIKE ? OR CAST(newapi_user_id AS TEXT) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
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
  newapiUserId: number | null;
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
          newapi_user_id = ?,
          newapi_token_id = ?,
          newapi_token_key = ?,
          activator_ip = ?,
          claimed_at = NULL
      WHERE id = ? AND status = 'activating'
    `).run(now, args.afterExpiresAt, args.newapiUserId, args.newapiTokenId, args.newapiTokenKey,
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
