import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import {
  GLM_BASE_REQUEST_QUOTA,
  GLM_REVIEW_BONUS_REQUEST_QUOTA,
  isGlmPlanId,
} from './glm-plans';

export { GLM_BASE_REQUEST_QUOTA, GLM_REVIEW_BONUS_REQUEST_QUOTA } from './glm-plans';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'cards.db');

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const inst = new Database(DB_PATH);
  inst.pragma('journal_mode = WAL');
  inst.pragma('foreign_keys = ON');
  inst.pragma('busy_timeout = 5000');
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
      request_quota INTEGER DEFAULT NULL,
      request_bonus_quota INTEGER NOT NULL DEFAULT 0,
      request_bonus_reason TEXT,
      request_bonus_at INTEGER,
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

    CREATE TABLE IF NOT EXISTS card_usage_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_code TEXT NOT NULL,
      newapi_token_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'newapi_bypass_backfill',
      model TEXT,
      request_count INTEGER NOT NULL DEFAULT 0,
      weighted_points INTEGER NOT NULL DEFAULT 0,
      original_started_at INTEGER NOT NULL,
      original_ended_at INTEGER NOT NULL,
      stat_day TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      voided_at INTEGER DEFAULT NULL,
      reason TEXT,
      external_batch_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cua_card ON card_usage_adjustments(card_code, newapi_token_id);
    CREATE INDEX IF NOT EXISTS idx_cua_stat_day ON card_usage_adjustments(card_code, stat_day);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cua_batch ON card_usage_adjustments(card_code, newapi_token_id, model, stat_day, source, external_batch_id);

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

    CREATE TABLE IF NOT EXISTS model_multiplier_settings (
      model TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      base_ratio REAL NOT NULL,
      multiplier REAL NOT NULL DEFAULT 1,
      effective_ratio REAL NOT NULL,
      updated_at INTEGER NOT NULL
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
      request_quota_transferred INTEGER NOT NULL DEFAULT 0,
      review_bonus_transferred INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS ppt_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT UNIQUE NOT NULL,
      card_id INTEGER NOT NULL,
      sk_key TEXT NOT NULL,
      title TEXT NOT NULL,
      scenario TEXT NOT NULL,
      style TEXT NOT NULL,
      slide_count INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      input_text TEXT NOT NULL,
      status TEXT NOT NULL,
      pptx_path TEXT,
      error_message TEXT,
      quota_charged INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ppt_tasks_task_id ON ppt_tasks(task_id);
    CREATE INDEX IF NOT EXISTS idx_ppt_tasks_card_id ON ppt_tasks(card_id);
    CREATE INDEX IF NOT EXISTS idx_ppt_tasks_sk_key ON ppt_tasks(sk_key);
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
  if (!cols.some((c) => c.name === 'rph_bonus')) {
    inst.exec('ALTER TABLE cards ADD COLUMN rph_bonus INTEGER DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'rph_bonus_reason')) {
    inst.exec('ALTER TABLE cards ADD COLUMN rph_bonus_reason TEXT');
  }
  if (!cols.some((c) => c.name === 'rph_bonus_at')) {
    inst.exec('ALTER TABLE cards ADD COLUMN rph_bonus_at INTEGER');
  }
  if (!cols.some((c) => c.name === 'request_quota')) {
    inst.exec('ALTER TABLE cards ADD COLUMN request_quota INTEGER DEFAULT NULL');
  }
  if (!cols.some((c) => c.name === 'request_bonus_quota')) {
    inst.exec('ALTER TABLE cards ADD COLUMN request_bonus_quota INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'request_bonus_reason')) {
    inst.exec('ALTER TABLE cards ADD COLUMN request_bonus_reason TEXT');
  }
  if (!cols.some((c) => c.name === 'request_bonus_at')) {
    inst.exec('ALTER TABLE cards ADD COLUMN request_bonus_at INTEGER');
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
  // 记录 GLM 续费基础额度与好评奖励是否已转移，避免重复补账。
  const renewalCols = inst.prepare('PRAGMA table_info(renewals)').all() as Array<{ name: string }>;
  if (!renewalCols.some((c) => c.name === 'request_quota_transferred')) {
    inst.exec('ALTER TABLE renewals ADD COLUMN request_quota_transferred INTEGER NOT NULL DEFAULT 0');
  }
  if (!renewalCols.some((c) => c.name === 'review_bonus_transferred')) {
    inst.exec('ALTER TABLE renewals ADD COLUMN review_bonus_transferred INTEGER NOT NULL DEFAULT 0');
    const legacyReviewBonuses = inst.prepare(
      `SELECT r.id AS renewal_id, r.original_card_id
       FROM renewals r
       JOIN cards renewal ON renewal.id = r.renewal_card_id
       WHERE renewal.category = 'glm'
         AND renewal.request_bonus_reason = 'good_review'
         AND COALESCE(renewal.request_bonus_quota, 0) > 0`,
    ).all() as Array<{ renewal_id: number; original_card_id: number }>;
    const backfillReviewBonuses = inst.transaction(() => {
      for (const row of legacyReviewBonuses) {
        inst.prepare(
          `UPDATE cards
           SET request_bonus_quota = COALESCE(request_bonus_quota, 0) + ?,
               request_bonus_reason = 'good_review',
               request_bonus_at = COALESCE(request_bonus_at, unixepoch())
           WHERE id = ?`,
        ).run(GLM_REVIEW_BONUS_REQUEST_QUOTA, row.original_card_id);
        inst.prepare(
          'UPDATE renewals SET review_bonus_transferred = 1 WHERE id = ?',
        ).run(row.renewal_id);
      }
    });
    backfillReviewBonuses();
  }
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
  // ppt_quota: 单卡 PPT 生成次数(NULL = 不限)
  if (!cols.some((c) => c.name === 'ppt_quota')) {
    inst.exec('ALTER TABLE cards ADD COLUMN ppt_quota INTEGER DEFAULT NULL');
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

  // video_create_operations 增量迁移
  const vcoCols = inst.prepare('PRAGMA table_info(video_create_operations)').all() as Array<{ name: string }>;
  if (!vcoCols.some((c) => c.name === 'upstream_task_id')) {
    inst.exec('ALTER TABLE video_create_operations ADD COLUMN upstream_task_id TEXT');
  }
  if (!vcoCols.some((c) => c.name === 'upstream_account_index')) {
    inst.exec('ALTER TABLE video_create_operations ADD COLUMN upstream_account_index INTEGER');
  }
  if (!vcoCols.some((c) => c.name === 'reservation_id')) {
    inst.exec('ALTER TABLE video_create_operations ADD COLUMN reservation_id INTEGER');
  }
  if (!vcoCols.some((c) => c.name === 'recovery_payload_json')) {
    inst.exec('ALTER TABLE video_create_operations ADD COLUMN recovery_payload_json TEXT');
  }

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
  /** 通用 RPH 加成(好评奖励/售后补偿/活动加成等) */
  rph_bonus: number;
  rph_bonus_reason: string | null;
  rph_bonus_at: number | null;
  /** 总请求次数基础额度;NULL = 不启用总请求次数限制 */
  request_quota: number | null;
  /** 请求次数奖励额度(GLM 好评 +166 等),不影响 RPH */
  request_bonus_quota: number;
  request_bonus_reason: string | null;
  request_bonus_at: number | null;
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
  /** PPT 生成次数(NULL = 不限) */
  ppt_quota: number | null;
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

export interface PptTask {
  id: number;
  task_id: string;
  card_id: number;
  sk_key: string;
  title: string;
  scenario: string;
  style: string;
  slide_count: number;
  template_id: string;
  input_text: string;
  status: string;
  pptx_path: string | null;
  error_message: string | null;
  quota_charged: number;
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

type InsertCardRow = Omit<
  Card,
  'id' | 'request_quota' | 'request_bonus_quota' | 'request_bonus_reason' | 'request_bonus_at' | 'ppt_quota'
> &
  Partial<Pick<Card, 'request_quota' | 'request_bonus_quota' | 'request_bonus_reason' | 'request_bonus_at' | 'ppt_quota'>>;

export function insertCard(row: InsertCardRow): number {
  const stmt = db().prepare(`
    INSERT INTO cards (code, plan, plan_days, category, rph, rph_bonus, rph_bonus_reason, rph_bonus_at, request_quota, request_bonus_quota, request_bonus_reason, request_bonus_at, video_quota, video_bonus_quota, ppt_quota, pool, status, created_at, activated_at, expires_at, newapi_user_id, newapi_token_id, newapi_token_key, activator_ip, disable_reason, notes)
    VALUES (@code, @plan, @plan_days, @category, @rph, @rph_bonus, @rph_bonus_reason, @rph_bonus_at, @request_quota, @request_bonus_quota, @request_bonus_reason, @request_bonus_at, @video_quota, @video_bonus_quota, @ppt_quota, @pool, @status, @created_at, @activated_at, @expires_at, @newapi_user_id, @newapi_token_id, @newapi_token_key, @activator_ip, @disable_reason, @notes)
  `);
  const info = stmt.run({
    ...row,
    rph_bonus: row.rph_bonus ?? 0,
    rph_bonus_reason: row.rph_bonus_reason ?? null,
    rph_bonus_at: row.rph_bonus_at ?? null,
    request_quota: row.request_quota ?? null,
    request_bonus_quota: row.request_bonus_quota ?? 0,
    request_bonus_reason: row.request_bonus_reason ?? null,
    request_bonus_at: row.request_bonus_at ?? null,
    ppt_quota: row.ppt_quota ?? null,
  });
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
      .prepare(
        `SELECT card.*
         FROM cards card
         LEFT JOIN renewals relation ON relation.renewal_card_id = card.id
         WHERE card.newapi_token_key = ?
         ORDER BY CASE WHEN relation.id IS NULL THEN 0 ELSE 1 END, card.id ASC
         LIMIT 1`,
      )
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

export function listVideoTasksByCardId(cardId: number, limit = 50): VideoTask[] {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return db()
    .prepare('SELECT * FROM video_tasks WHERE card_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(cardId, safeLimit) as VideoTask[];
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

export function insertPptTask(row: Omit<PptTask, 'id' | 'created_at' | 'updated_at'>): PptTask {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(
    `INSERT INTO ppt_tasks (
      task_id, card_id, sk_key, title, scenario, style, slide_count, template_id,
      input_text, status, pptx_path, error_message, quota_charged, created_at, updated_at
    ) VALUES (
      @task_id, @card_id, @sk_key, @title, @scenario, @style, @slide_count, @template_id,
      @input_text, @status, @pptx_path, @error_message, @quota_charged, @created_at, @updated_at
    )`
  ).run({ ...row, created_at: now, updated_at: now });
  return getPptTaskByTaskId(row.task_id) as PptTask;
}

export function getPptTaskByTaskId(taskId: string): PptTask | null {
  return (
    (db().prepare('SELECT * FROM ppt_tasks WHERE task_id = ?').get(taskId) as PptTask) || null
  );
}

export function updatePptTask(
  taskId: string,
  patch: Partial<Pick<PptTask, 'status' | 'pptx_path' | 'error_message' | 'quota_charged'>>
): PptTask | null {
  const task = getPptTaskByTaskId(taskId);
  if (!task) return null;
  const next = {
    status: patch.status ?? task.status,
    pptx_path: 'pptx_path' in patch ? (patch.pptx_path ?? null) : task.pptx_path,
    error_message: 'error_message' in patch ? (patch.error_message ?? null) : task.error_message,
    quota_charged: patch.quota_charged ?? task.quota_charged,
    updated_at: Math.floor(Date.now() / 1000),
    task_id: taskId,
  };
  db().prepare(
    `UPDATE ppt_tasks
     SET status = @status,
         pptx_path = @pptx_path,
         error_message = @error_message,
         quota_charged = @quota_charged,
         updated_at = @updated_at
     WHERE task_id = @task_id`
  ).run(next);
  return getPptTaskByTaskId(taskId);
}

/** 查询某卡密已消耗的 PPT 生成次数 */
export function getPptQuotaUsed(cardId: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM ppt_tasks WHERE card_id = ? AND quota_charged = 1')
    .get(cardId) as { c: number };
  return row?.c || 0;
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
      WHERE account_index = ? AND (
        (status = 'reserved' AND expires_at > ?)
        OR status = 'uncertain'
      )`)
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
  upstream_task_id: string | null;
  upstream_account_index: number | null;
  reservation_id: number | null;
  recovery_payload_json: string | null;
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

/** 获取某个 operation_id 下当前 active 的 reservation (reserved/uncertain/committed) */
export function getActiveReservationByOperationId(operationId: string): VideoQuotaReservation | null {
  return (db().prepare(
    "SELECT * FROM video_quota_reservations WHERE operation_id = ? AND status IN ('reserved', 'uncertain', 'committed') ORDER BY created_at DESC LIMIT 1"
  ).get(operationId) as VideoQuotaReservation) || null;
}

/** 列出某个 operation_id 已经尝试过的所有 account_index */
export function listAttemptedAccountIndexes(operationId: string): number[] {
  const rows = db().prepare(
    'SELECT DISTINCT account_index FROM video_quota_reservations WHERE operation_id = ?'
  ).all(operationId) as Array<{ account_index: number }>;
  return rows.map((r) => r.account_index);
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

/** 查出 Success + pending attribution 的任务,供 reconcile 补偿结算 */
export function getPendingInviteSettlementTasks(limit = 50): VideoTask[] {
  return db()
    .prepare(
      `SELECT vt.* FROM video_tasks vt
       INNER JOIN invite_attributions ia ON ia.video_task_id = vt.id
       WHERE vt.status = 'Success' AND ia.status = 'pending'
       ORDER BY vt.created_at ASC LIMIT ?`
    )
    .all(limit) as VideoTask[];
}

/** 按 operation_id 查 video_task */
export function getVideoTaskByOperationId(opId: string): VideoTask | null {
  return (db().prepare('SELECT * FROM video_tasks WHERE operation_id = ?').get(opId) as VideoTask) || null;
}

/**
 * 原子落库: insert task + commit reservation + update operation。
 * IMMEDIATE 事务保证三者同时成功或全部回滚。
 * 如果 operation_id 已有 task,直接返回已有 task,不重复创建。
 */
export function finalizeVideoSubmission(taskRow: Omit<VideoTask, 'id' | 'created_at' | 'updated_at'>, reservationId: number): VideoTask {
  return db().transaction(() => {
    // 幂等: 已有 task 直接返回
    const existing = getVideoTaskByOperationId(taskRow.operation_id!);
    if (existing) return existing;

    const task = insertVideoTask(taskRow);

    // 必须带 WHERE status='reserved' + 交叉校验防止错用 reservation
    const now = Math.floor(Date.now() / 1000);
    const res = db().prepare(
      `UPDATE video_quota_reservations SET status = 'committed', committed_at = ?
       WHERE id = ? AND status = 'reserved'
       AND operation_id = ? AND card_id = ? AND account_index = ? AND quota_source = ?`
    ).run(now, reservationId, taskRow.operation_id!, taskRow.card_id, taskRow.account_index, taskRow.quota_source);
    if (res.changes !== 1) throw new Error('reservation commit failed: not in reserved state or fields mismatch');

    updateVideoCreateOperation(taskRow.operation_id!, { status: 'submitted', video_task_id: task.id });

    return task;
  }).immediate() as VideoTask;
}

/**
 * 原子操作: 同时设置 operation 和 reservation 为 uncertain，记录上游恢复信息。
 * 替代分开调用 recordRecoverableUncertainSubmission() + markReservationUncertain()。
 */
export function markSubmissionUncertain(opId: string, attemptId: string, data: {
  upstream_task_id: string;
  upstream_account_index: number;
  reservation_id: number;
  recovery_payload_json: string;
}): void {
  return db().transaction(() => {
    const now = Math.floor(Date.now() / 1000);

    db().prepare(
      `UPDATE video_create_operations SET
        status = 'uncertain',
        upstream_task_id = ?,
        upstream_account_index = ?,
        reservation_id = ?,
        recovery_payload_json = ?,
        last_error = ?,
        updated_at = ?
      WHERE operation_id = ?`
    ).run(
      data.upstream_task_id,
      data.upstream_account_index,
      data.reservation_id,
      data.recovery_payload_json,
      '本地落库失败: 视频上游已返回task_id但DB写入失败',
      now,
      opId,
    );

    db().prepare(
      "UPDATE video_quota_reservations SET status = 'uncertain' WHERE attempt_id = ?"
    ).run(attemptId);
  }).immediate();
}

/**
 * 视频上游已返回 task_id 但本地 DB 落库失败时,保存上游信息供 reconcile 恢复。
 * recovery_payload_json 仅保存 model/prompt/duration/resolution/quota_source,不保存图片 Data URL。
 * @deprecated 请使用原子函数 markSubmissionUncertain()
 */
export function recordRecoverableUncertainSubmission(opId: string, data: {
  upstream_task_id: string;
  upstream_account_index: number;
  reservation_id: number;
  recovery_payload_json: string;
}): void {
  const now = Math.floor(Date.now() / 1000);
  db().prepare(
    `UPDATE video_create_operations SET
      status = 'uncertain',
      upstream_task_id = ?,
      upstream_account_index = ?,
      reservation_id = ?,
      recovery_payload_json = ?,
      last_error = ?,
      updated_at = ?
    WHERE operation_id = ?`
  ).run(
    data.upstream_task_id,
    data.upstream_account_index,
    data.reservation_id,
    data.recovery_payload_json,
    '本地落库失败: 视频上游已返回task_id但DB写入失败',
    now,
    opId,
  );
}

/** 查出 uncertain 且 upstream_task_id 非空的 operation,供 reconcile 自动恢复 */
export function getRecoverableUncertainOperations(limit = 50): VideoCreateOperation[] {
  return db()
    .prepare(
      `SELECT * FROM video_create_operations
       WHERE status = 'uncertain' AND upstream_task_id IS NOT NULL
       ORDER BY created_at ASC LIMIT ?`
    )
    .all(limit) as VideoCreateOperation[];
}

/**
 * 从 uncertain operation 恢复: 补写 video_tasks,commit reservation,set operation→submitted。
 * IMMEDIATE 事务,已恢复过的 operation 幂等返回已有 task。
 */
export function recoverUncertainSubmission(opId: string): VideoTask {
  return db().transaction(() => {
    // 幂等: 已有 task 直接返回
    const existing = getVideoTaskByOperationId(opId);
    if (existing) return existing;

    const op = db().prepare('SELECT * FROM video_create_operations WHERE operation_id = ?').get(opId) as VideoCreateOperation | undefined;
    if (!op || op.status !== 'uncertain' || !op.upstream_task_id) {
      throw new Error('Operation not recoverable');
    }

    const card = db().prepare('SELECT * FROM cards WHERE id = ?').get(op.card_id) as Card | undefined;
    if (!card) throw new Error('Card not found for recovery');

    const payload = JSON.parse(op.recovery_payload_json!);

    const task = insertVideoTask({
      task_id: op.upstream_task_id!,
      card_id: op.card_id,
      sk_key: card.newapi_token_key || card.code,
      model: payload.model,
      prompt: payload.prompt,
      duration: payload.duration,
      resolution: payload.resolution,
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: op.upstream_account_index!,
      quota_source: payload.quota_source,
      reservation_id: op.reservation_id,
      operation_id: opId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    });

    const now = Math.floor(Date.now() / 1000);
    const res = db().prepare(
      `UPDATE video_quota_reservations SET status = 'committed', committed_at = ?
       WHERE id = ? AND status = 'uncertain'
       AND operation_id = ? AND card_id = ? AND account_index = ? AND quota_source = ?`
    ).run(now, op.reservation_id, opId, op.card_id, op.upstream_account_index, payload.quota_source);
    if (res.changes !== 1) throw new Error('recovery reservation commit failed');

    updateVideoCreateOperation(opId, { status: 'submitted', video_task_id: task.id });

    return task;
  }).immediate() as VideoTask;
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

/** 统计某张卡从 sinceSec 到现在的请求次数(用于轻度月卡滚动窗口限额) */
export function countCardRequestsSince(cardId: number, sinceSec: number): number {
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM request_logs WHERE card_id = ? AND ts >= ?')
    .get(cardId, sinceSec) as { c: number };
  return row.c;
}

/** 当前自然小时内某张卡密(card_id)的请求数(整点固定窗口) */
export function countCurrentHourRequestsByCard(cardId: number): {
  used: number;
  hourStart: number;
  nextResetAt: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const hourStart = Math.floor(now / 3600) * 3600;
  const nextResetAt = hourStart + 3600;
  const row = db()
    .prepare('SELECT COUNT(*) as c FROM request_logs WHERE card_id = ? AND ts >= ?')
    .get(cardId, hourStart) as { c: number };
  return { used: row.c, hourStart, nextResetAt };
}

/** DeepSeek 轻度月卡模型消耗权重：flash=1点, pro=3点, 别名 DeepSeek=1点 */
export function getDeepSeekLightRequestWeight(model: string | null): number {
  const m = (model || '').trim();
  if (m === 'deepseek-v4-pro') return 3;
  if (m === 'deepseek-v4-flash' || m === 'DeepSeek') return 1;
  return 1; // 未知/其他 deepseek 模型默认 1
}

/** 统计某张卡从 sinceSec 到现在的加权调用点数(仅轻度月卡使用) */
export function countCardWeightedPoints(cardId: number, sinceSec: number): number {
  const row = db()
    .prepare(
      `SELECT SUM(
        CASE
          WHEN model = 'deepseek-v4-pro' THEN 3
          WHEN model = 'deepseek-v4-flash' THEN 1
          ELSE 1
        END
      ) as total FROM request_logs WHERE card_id = ? AND ts >= ?`
    )
    .get(cardId, sinceSec) as { total: number | null };
  return row.total ?? 0;
}

/** DeepSeek 轻度月卡点数配额 */
export const DS_LIGHT_QUOTA_24H = 2000;
export const DS_LIGHT_QUOTA_7D = 10000;
export const DS_LIGHT_QUOTA_TOTAL = 40000;

/** DeepSeek 轻度月卡加权点数统计(从 request_logs + card_usage_adjustments 合并读取) */
export function getDeepSeekLightWeightedUsage(card: {
  id: number;
  activated_at: number | null;
  code?: string;
  newapi_token_id?: number | null;
}): {
  weightedPoints24h: number;
  weightedPoints7d: number;
  weightedPointsTotal: number;
  weightedQuota24h: number;
  weightedQuota7d: number;
  weightedQuotaTotal: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const since24h = now - 86400;
  const since7d = now - 7 * 86400;
  const sinceActivation = card.activated_at ?? now;
  const rl24h = countCardWeightedPoints(card.id, since24h);
  const rl7d = countCardWeightedPoints(card.id, since7d);
  const rlTotal = countCardWeightedPoints(card.id, sinceActivation);

  // 合并补账点数: 按原始时间窗口 (original_started_at) 归入 24h / 7d / total
  let adj24h = 0;
  let adj7d = 0;
  let adjTotal = 0;
  if (card.code && card.newapi_token_id) {
    const adjustments = db()
      .prepare(
        `SELECT weighted_points, original_started_at, original_ended_at
         FROM card_usage_adjustments
         WHERE card_code = ? AND newapi_token_id = ? AND voided_at IS NULL`,
      )
      .all(card.code, card.newapi_token_id) as Array<{
        weighted_points: number;
        original_started_at: number;
        original_ended_at: number;
      }>;
    for (const adj of adjustments) {
      // 补账窗口落在 24h 内
      if (adj.original_ended_at >= since24h) adj24h += adj.weighted_points;
      // 补账窗口落在 7d 内
      if (adj.original_ended_at >= since7d) adj7d += adj.weighted_points;
      // 补账窗口落在激活后
      if (adj.original_ended_at >= sinceActivation) adjTotal += adj.weighted_points;
    }
  }

  return {
    weightedPoints24h: rl24h + adj24h,
    weightedPoints7d: rl7d + adj7d,
    weightedPointsTotal: rlTotal + adjTotal,
    weightedQuota24h: DS_LIGHT_QUOTA_24H,
    weightedQuota7d: DS_LIGHT_QUOTA_7D,
    weightedQuotaTotal: DS_LIGHT_QUOTA_TOTAL,
  };
}

export function isGlmRequestQuotaCard(card: { category: string | null; plan: string }): boolean {
  return card.category === 'glm' && isGlmPlanId(card.plan);
}

export function getBaseRequestQuota(card: {
  category: string | null;
  plan: string;
  request_quota?: number | null;
}): number | null {
  if (isGlmRequestQuotaCard(card)) {
    return Number(card.request_quota ?? GLM_BASE_REQUEST_QUOTA);
  }
  return card.request_quota === null || card.request_quota === undefined
    ? null
    : Math.max(0, Number(card.request_quota));
}

export function getEffectiveRequestQuota(card: {
  category: string | null;
  plan: string;
  request_quota?: number | null;
  request_bonus_quota?: number | null;
}): number | null {
  const base = getBaseRequestQuota(card);
  if (base === null) return null;
  return base + Math.max(0, Number(card.request_bonus_quota || 0));
}

export function isGlmReviewBonusEligible(card: {
  category: string | null;
  plan: string;
  status: string;
}): boolean {
  return isGlmRequestQuotaCard(card)
    && card.status !== 'expired'
    && card.status !== 'disabled';
}

/** 统计某卡从 sinceSec 起的成功请求次数;GLM 总请求额度使用这个口径。 */
export function countCardBillableRequestsSince(cardId: number, sinceSec: number): number {
  const row = db()
    .prepare(
      `SELECT COUNT(*) as c
       FROM request_logs
       WHERE card_id = ?
         AND ts >= ?
         AND status >= 200
         AND status < 400`
    )
    .get(cardId, sinceSec) as { c: number };
  return row.c || 0;
}

export function getGlmRequestUsage(card: {
  id: number;
  category: string | null;
  plan: string;
  activated_at: number | null;
  request_quota?: number | null;
  request_bonus_quota?: number | null;
}): {
  requestQuota: number | null;
  requestBonusQuota: number;
  effectiveRequestQuota: number | null;
  usedRequests: number;
  remainingRequests: number | null;
} {
  const requestQuota = getBaseRequestQuota(card);
  const requestBonusQuota = Math.max(0, Number(card.request_bonus_quota || 0));
  const effectiveRequestQuota = getEffectiveRequestQuota(card);
  const usedRequests =
    isGlmRequestQuotaCard(card) && card.activated_at
      ? countCardBillableRequestsSince(card.id, card.activated_at)
      : 0;
  return {
    requestQuota,
    requestBonusQuota,
    effectiveRequestQuota,
    usedRequests,
    remainingRequests:
      effectiveRequestQuota === null
        ? null
        : Math.max(0, effectiveRequestQuota - usedRequests),
  };
}

/** RPH 加成适用判断(仅用于 RPH 计算)：策略函数，当前仅 deepseek 1d/7d/30d 允许 */
export function canUseRphBonus(card: { category: string | null; plan: string }): boolean {
  return card.category === 'deepseek'
    && ['1d', '7d', '30d'].includes(card.plan);
}

/** RPH 加成资格判断(后台按钮显示用)：额外排除 expired/disabled */
export function isRphBonusEligible(card: { category: string | null; plan: string; status: string }): boolean {
  return card.category === 'deepseek'
    && ['1d', '7d', '30d'].includes(card.plan)
    && card.status !== 'expired'
    && card.status !== 'disabled';
}

/** 实际 RPH = 基础 rph + rph_bonus(仅适用范围内的卡才叠加) */
export function getEffectiveRph(card: { category: string | null; plan: string; rph: number; rph_bonus: number }): number {
  const base = Number(card.rph || 0);
  if (!canUseRphBonus(card)) return base;
  return base + Number(card.rph_bonus || 0);
}

/** 应用 RPH 加成。默认好评 +55,后台可传自定义每小时加成值。 */
export function applyRphBonus(code: string, amount = 55): Card | null {
  const now = Math.floor(Date.now() / 1000);
  const bonus = Math.trunc(Number(amount));
  if (!Number.isFinite(bonus) || bonus < 1) return null;
  const card = getCardByCode(code);
  if (!card) return null;
  if (!isRphBonusEligible(card)) return null;

  // 续费场景：同一 newapi_token_key 可能被多张卡共享。getCardByTokenKey 返回
  // 最小 id 的那张，所以加成必须同步到所有共享该 token 的卡，否则代理侧读不到。
  if (card.newapi_token_key) {
    db().prepare(
      'UPDATE cards SET rph_bonus = ?, rph_bonus_reason = ?, rph_bonus_at = ? WHERE newapi_token_key = ?'
    ).run(bonus, 'good_review', now, card.newapi_token_key);
  } else {
    db().prepare(
      'UPDATE cards SET rph_bonus = ?, rph_bonus_reason = ?, rph_bonus_at = ? WHERE code = ?'
    ).run(bonus, 'good_review', now, code);
  }
  return getCardByCode(code);
}

/** 撤销 RPH 加成 */
export function clearRphBonus(code: string): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;

  if (card.newapi_token_key) {
    db().prepare(
      'UPDATE cards SET rph_bonus = 0, rph_bonus_reason = NULL, rph_bonus_at = NULL WHERE newapi_token_key = ?'
    ).run(card.newapi_token_key);
  } else {
    db().prepare(
      'UPDATE cards SET rph_bonus = 0, rph_bonus_reason = NULL, rph_bonus_at = NULL WHERE code = ?'
    ).run(code);
  }
  return getCardByCode(code);
}

/** GLM 好评 +166 请求次数奖励;不写 rph_bonus,不影响 DeepSeek。 */
export function applyGlmReviewBonus(code: string): Card | null {
  const now = Math.floor(Date.now() / 1000);
  const card = getCardByCode(code);
  if (!card) return null;
  if (!isGlmReviewBonusEligible(card)) return null;

  const relation = db().prepare(
    `SELECT id, original_card_id, review_bonus_transferred
     FROM renewals
     WHERE renewal_card_id = ?
     LIMIT 1`,
  ).get(card.id) as {
    id: number;
    original_card_id: number;
    review_bonus_transferred: number;
  } | undefined;
  const ownerCardId = relation?.original_card_id ?? card.id;

  const tx = db().transaction(() => {
    const sourceUpdate = db().prepare(
      `UPDATE cards
       SET request_bonus_quota = MAX(COALESCE(request_bonus_quota, 0), ?),
           request_bonus_reason = ?,
           request_bonus_at = ?
       WHERE id = ?`,
    ).run(GLM_REVIEW_BONUS_REQUEST_QUOTA, 'good_review', now, card.id);
    if (sourceUpdate.changes !== 1) throw new Error('GLM review source card update failed');

    if (ownerCardId !== card.id && relation && relation.review_bonus_transferred !== 1) {
      const ownerUpdate = db().prepare(
        `UPDATE cards
         SET request_bonus_quota = COALESCE(request_bonus_quota, 0) + ?,
             request_bonus_reason = 'good_review',
             request_bonus_at = ?
         WHERE id = ?`,
      ).run(GLM_REVIEW_BONUS_REQUEST_QUOTA, now, ownerCardId);
      if (ownerUpdate.changes !== 1) throw new Error('GLM review owner card update failed');
      const relationUpdate = db().prepare(
        `UPDATE renewals
         SET review_bonus_transferred = 1
         WHERE id = ? AND review_bonus_transferred = 0`,
      ).run(relation.id);
      if (relationUpdate.changes !== 1) throw new Error('GLM review transfer marker update failed');
    }
  });
  tx();
  return getCardByCode(code);
}

export function clearGlmReviewBonus(code: string): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  if (!isGlmRequestQuotaCard(card)) return null;

  const relation = db().prepare(
    `SELECT id, original_card_id, review_bonus_transferred
     FROM renewals
     WHERE renewal_card_id = ?
     LIMIT 1`,
  ).get(card.id) as {
    id: number;
    original_card_id: number;
    review_bonus_transferred: number;
  } | undefined;

  const tx = db().transaction(() => {
    db().prepare(
      `UPDATE cards
       SET request_bonus_quota = 0,
           request_bonus_reason = NULL,
           request_bonus_at = NULL
       WHERE id = ?`,
    ).run(card.id);

    if (relation?.review_bonus_transferred === 1) {
      const ownerUpdate = db().prepare(
        `UPDATE cards
         SET request_bonus_quota = MAX(0, COALESCE(request_bonus_quota, 0) - ?),
             request_bonus_reason = CASE
               WHEN COALESCE(request_bonus_quota, 0) - ? > 0 THEN request_bonus_reason
               ELSE NULL
             END,
             request_bonus_at = CASE
               WHEN COALESCE(request_bonus_quota, 0) - ? > 0 THEN request_bonus_at
               ELSE NULL
             END
         WHERE id = ?`,
      ).run(
        GLM_REVIEW_BONUS_REQUEST_QUOTA,
        GLM_REVIEW_BONUS_REQUEST_QUOTA,
        GLM_REVIEW_BONUS_REQUEST_QUOTA,
        relation.original_card_id,
      );
      if (ownerUpdate.changes !== 1) throw new Error('GLM review owner bonus clear failed');
      db().prepare(
        'UPDATE renewals SET review_bonus_transferred = 0 WHERE id = ?',
      ).run(relation.id);
    }
  });
  tx();
  return getCardByCode(code);
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

/** 查询 card_usage_adjustments 的合并统计 (用于 request_logs 补账, 排除已 void 的记录) */
function getAdjustmentStats(
  cardCode: string,
  newapiTokenId: number | null,
): { total: number; byDate: Map<string, number> } {
  const total = { total: 0 };
  const byDate = new Map<string, number>();
  if (!newapiTokenId) return { total: 0, byDate };
  const rows = db()
    .prepare(
      `SELECT request_count, stat_day
       FROM card_usage_adjustments
       WHERE card_code = ? AND newapi_token_id = ? AND voided_at IS NULL`,
    )
    .all(cardCode, newapiTokenId) as Array<{
    request_count: number;
    stat_day: string | null;
  }>;
  for (const r of rows) {
    total.total += r.request_count;
    const day = r.stat_day || 'unknown';
    byDate.set(day, (byDate.get(day) || 0) + r.request_count);
  }
  return { total: total.total, byDate };
}

/** 合并 request_logs + card_usage_adjustments 的累计统计(30d_light 用) */
export function getMergedTotalRequestStats(
  skKey: string,
  cardCode: string,
  newapiTokenId: number | null,
): { total: number; success: number; failed: number } {
  const rl = getTotalRequestStats(skKey);
  const adj = getAdjustmentStats(cardCode, newapiTokenId);
  return {
    total: rl.total + adj.total,
    success: rl.success + adj.total, // 补账记录默认视为成功
    failed: rl.failed,
  };
}

/** 合并 request_logs + card_usage_adjustments 的近 N 天每日请求数 */
export function getMergedDailyCountsLastNDays(
  skKey: string,
  cardCode: string,
  newapiTokenId: number | null,
  days: number,
): Array<{ date: string; count: number }> {
  const rlDaily = getDailyCountsLastNDays(skKey, days);
  const adj = getAdjustmentStats(cardCode, newapiTokenId);
  if (adj.total === 0) return rlDaily;
  // 合并: 把 adj 的每日数量加到对应日期上
  for (const d of rlDaily) {
    const adjCount = adj.byDate.get(d.date) || 0;
    d.count += adjCount;
  }
  return rlDaily;
}

/** 合并 request_logs + card_usage_adjustments 近 N 天按模型分布(堆叠柱状图用) */
export function getMergedDailyCountsByModelLastNDays(
  skKey: string,
  cardCode: string,
  newapiTokenId: number | null,
  days: number,
): Array<{ date: string; total: number; by_model: Record<string, number> }> {
  const rlDaily = getDailyCountsByModelLastNDays(skKey, days);
  if (!newapiTokenId) return rlDaily;

  // 读取未 void 的调整记录, 按 stat_day + model 汇总
  const adjRows = db()
    .prepare(
      `SELECT stat_day, model, SUM(request_count) as cnt
       FROM card_usage_adjustments
       WHERE card_code = ? AND newapi_token_id = ?
         AND stat_day IS NOT NULL AND voided_at IS NULL
       GROUP BY stat_day, model`,
    )
    .all(cardCode, newapiTokenId) as Array<{ stat_day: string; model: string; cnt: number }>;

  if (adjRows.length === 0) return rlDaily;

  // 按日期合并
  const adjByDate = new Map<string, Record<string, number>>();
  for (const r of adjRows) {
    const byModel = adjByDate.get(r.stat_day) || {};
    byModel[r.model] = (byModel[r.model] || 0) + r.cnt;
    adjByDate.set(r.stat_day, byModel);
  }

  for (const d of rlDaily) {
    const byModel = adjByDate.get(d.date);
    if (!byModel) continue;
    for (const [model, cnt] of Object.entries(byModel)) {
      d.by_model[model] = (d.by_model[model] || 0) + cnt;
      d.total += cnt;
    }
  }
  return rlDaily;
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

/** Admin 到期时间管理：时间戳表示有限期，null 表示永久有效。 */
export function setCardExpiry(code: string, newExpiresAt: number | null): Card | null {
  const card = getCardByCode(code);
  if (!card) return null;
  if (newExpiresAt !== null && (!Number.isFinite(newExpiresAt) || newExpiresAt <= 0)) {
    throw new Error(`非法 newExpiresAt=${newExpiresAt}`);
  }
  db().prepare(`
    UPDATE cards
    SET expires_at = ?,
        status = CASE WHEN status = 'expired' THEN 'activated' ELSE status END
    WHERE code = ?
  `).run(newExpiresAt, code);
  return getCardByCode(code);
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

// =============================== 模型高峰倍率 ===============================

export interface ModelMultiplierSetting {
  model: string;
  category: string;
  base_ratio: number;
  multiplier: number;
  effective_ratio: number;
  updated_at: number;
}

export function listModelMultiplierSettings(): ModelMultiplierSetting[] {
  return db()
    .prepare('SELECT * FROM model_multiplier_settings ORDER BY category, model')
    .all() as ModelMultiplierSetting[];
}

export function saveModelMultiplierSettings(settings: ModelMultiplierSetting[]): void {
  if (settings.length === 0) return;
  const stmt = db().prepare(`
    INSERT INTO model_multiplier_settings
      (model, category, base_ratio, multiplier, effective_ratio, updated_at)
    VALUES
      (@model, @category, @base_ratio, @multiplier, @effective_ratio, @updated_at)
    ON CONFLICT(model) DO UPDATE SET
      category = excluded.category,
      base_ratio = excluded.base_ratio,
      multiplier = excluded.multiplier,
      effective_ratio = excluded.effective_ratio,
      updated_at = excluded.updated_at
  `);
  const tx = db().transaction((rows: ModelMultiplierSetting[]) => {
    for (const row of rows) stmt.run(row);
  });
  tx(settings);
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
  request_quota_transferred: number;
  review_bonus_transferred: number;
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
  // GLM 续费同时转移续费卡的基础请求额度；好评奖励单独叠加。
  // 其他任意奖励和 RPH 均不得转移或增加。
  const now = Math.floor(Date.now() / 1000);
  const tx = db().transaction(() => {
    const renewalEntitlements = db().prepare(
      `SELECT category, plan, request_quota, request_bonus_quota, request_bonus_reason
       FROM cards WHERE id = ?`,
    ).get(args.renewalCardId) as {
      category: string | null;
      plan: string;
      request_quota: number | null;
      request_bonus_quota: number | null;
      request_bonus_reason: string | null;
    } | undefined;
    const requestQuota = renewalEntitlements && isGlmRequestQuotaCard(renewalEntitlements)
      ? Math.max(0, Number(renewalEntitlements.request_quota ?? GLM_BASE_REQUEST_QUOTA))
      : 0;
    const reviewBonus =
      renewalEntitlements?.category === 'glm'
      && renewalEntitlements.request_bonus_reason === 'good_review'
      && Number(renewalEntitlements.request_bonus_quota || 0) > 0
        ? GLM_REVIEW_BONUS_REQUEST_QUOTA
        : 0;

    const r = db().prepare(`
      INSERT INTO renewals (original_card_id, renewal_card_id, renewed_at,
                            before_expires_at, after_expires_at, added_days,
                            newapi_token_id, request_quota_transferred,
                            review_bonus_transferred, renewal_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      args.originalCardId, args.renewalCardId, now,
      args.beforeExpiresAt, args.afterExpiresAt, args.addedDays,
      args.newapiTokenId, requestQuota > 0 ? 1 : 0,
      reviewBonus > 0 ? 1 : 0, args.renewalIp,
    );
    if (r.changes !== 1) throw new Error('renewal insert failed');

    const u1 = db().prepare(
      `UPDATE cards
       SET expires_at = ?,
           status = 'activated',
           request_quota = CASE
             WHEN ? > 0 THEN COALESCE(request_quota, ?) + ?
             ELSE request_quota
           END
       WHERE id = ?`,
    ).run(
      args.afterExpiresAt,
      requestQuota,
      GLM_BASE_REQUEST_QUOTA,
      requestQuota,
      args.originalCardId,
    );
    if (u1.changes !== 1) throw new Error('original card update failed');

    if (reviewBonus > 0) {
      const bonusUpdate = db().prepare(
        `UPDATE cards
         SET request_bonus_quota = COALESCE(request_bonus_quota, 0) + ?,
             request_bonus_reason = 'good_review',
             request_bonus_at = ?
         WHERE id = ?`,
      ).run(reviewBonus, now, args.originalCardId);
      if (bonusUpdate.changes !== 1) throw new Error('original card review bonus update failed');
    }

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

export interface RenewalRelation extends Renewal {
  original_card_code: string;
  renewal_card_code: string;
}

export interface CardRenewalRelations {
  /** 这张卡作为续费卡时,它续给了哪张原卡。 */
  renewed_from: RenewalRelation | null;
  /** 这张卡作为原卡时,有哪些卡续给了它。 */
  renewed_by: RenewalRelation[];
}

/**
 * 批量查询卡密的双向续费关系,供管理后台列表展示。
 * 一次 JOIN 同时带回原卡和续费卡代码,避免逐行 N+1 查询。
 */
export function listRenewalRelationsForCardIds(
  cardIds: number[],
): Record<number, CardRenewalRelations> {
  const uniqueIds = [...new Set(cardIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result: Record<number, CardRenewalRelations> = Object.fromEntries(
    uniqueIds.map((id) => [id, { renewed_from: null, renewed_by: [] }]),
  );
  if (uniqueIds.length === 0) return result;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = db()
    .prepare(`
      SELECT r.*,
             original.code AS original_card_code,
             renewal.code AS renewal_card_code
      FROM renewals r
      JOIN cards original ON original.id = r.original_card_id
      JOIN cards renewal ON renewal.id = r.renewal_card_id
      WHERE r.original_card_id IN (${placeholders})
         OR r.renewal_card_id IN (${placeholders})
      ORDER BY r.renewed_at DESC, r.id DESC
    `)
    .all(...uniqueIds, ...uniqueIds) as RenewalRelation[];

  for (const row of rows) {
    const original = result[row.original_card_id];
    if (original) original.renewed_by.push(row);
    const renewal = result[row.renewal_card_id];
    if (renewal) renewal.renewed_from = row;
  }
  return result;
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
