/**
 * 每日用量与并发风控日报 — 只读脚本
 *
 * 统计维度:
 *   1. 今日消耗 Top 10 (NewAPI quota)
 *   2. 今日请求次数 Top 10 (nassa request_logs)
 *   3. 今日并发 Top 10 (分钟桶近似)
 *   4. 今日错误率 Top 10
 *   5. 疑似绕过检测 (NewAPI logs 有但 nassa request_logs 无)
 *   6. disabled 卡仍有 NewAPI 请求
 *   7. allow_ips 风险
 *   8. 额度接近上限提醒 (30d_light / 1d card cost cap)
 *
 * 用法:
 *   npm run daily-usage-risk-report                   # 默认今天, human-readable
 *   npm run daily-usage-risk-report -- --today         # 今天
 *   npm run daily-usage-risk-report -- --yesterday     # 昨天
 *   npm run daily-usage-risk-report -- --hours 24      # 最近 N 小时
 *   npm run daily-usage-risk-report -- --json          # JSON 输出
 *
 * 安全约束:
 *   - SQLite 只读连接
 *   - MySQL 仅 SELECT 查询
 *   - 不输出完整 sk / token / prompt
 *   - 不修改任何数据
 *   - 不重启服务
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';

// ═══════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════

/** 北京时间(UTC+8)当天 00:00:00 的 Unix 秒 */
function beijingTodayStartSeconds(): number {
  const now = Math.floor(Date.now() / 1000);
  const offset = 8 * 3600;
  return Math.floor((now + offset) / 86400) * 86400 - offset;
}

/** 北京时间(UTC+8)当天日期字符串 YYYY-MM-DD */
function beijingDateString(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 卡密脱敏: GP-826A-XXXX-P74U */
function maskCard(code: string): string {
  if (!code) return code;
  const parts = code.split('-');
  if (parts.length >= 4) {
    parts[2] = '****';
    return parts.join('-');
  }
  if (code.length > 8) return code.slice(0, 4) + '-****-' + code.slice(-4);
  return code;
}

/** sk 脱敏: sk-abc123****wxyz */
function maskSkKey(sk: string): string {
  if (!sk || sk.length <= 16) return sk;
  return sk.slice(0, 8) + '****' + sk.slice(-4);
}

/** IPv4 脱敏: 117.151.92.xxx */
function maskIP(ip: string): string {
  if (!ip || ip === 'unknown') return ip || 'unknown';
  if (ip.includes(':')) {
    // IPv6: keep first segment
    return ip.split(':').slice(0, 2).join(':') + ':****';
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    parts[3] = 'xxx';
    return parts.join('.');
  }
  return ip;
}

/** allow_ips 脱敏: 172.18.0.1/32 → 172.18.0.xxx/32 */
function maskAllowIps(allowIps: string): string {
  const raw = (allowIps || '').trim();
  if (!raw) return '(空)';
  return raw
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      const [addr, cidr] = trimmed.split('/');
      const masked = maskIP(addr);
      return cidr ? `${masked}/${cidr}` : masked;
    })
    .join(',');
}

/** NewAPI quota → USD (1 USD = 500,000 quota) */
const QUOTA_PER_USD = 500000;

function quotaToUsd(q: number): number {
  return Math.round((q / QUOTA_PER_USD) * 100) / 100;
}

function fmtUsd(q: number): string {
  return '$' + quotaToUsd(q).toFixed(2);
}

function fmtLargeNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ═══════════════════════════════════════════════════════
// CLI 参数解析
// ═══════════════════════════════════════════════════════

const args = process.argv.slice(2);
const useJson = args.includes('--json');
const useYesterday = args.includes('--yesterday');
const hoursArg = args.find((a) => a.startsWith('--hours='));
const customHours = hoursArg ? Number(hoursArg.split('=')[1]) : null;

let windowStartSec: number;
let windowEndSec: number;
let windowLabel: string;

const now = Math.floor(Date.now() / 1000);

if (customHours && Number.isFinite(customHours) && customHours > 0) {
  windowEndSec = now;
  windowStartSec = now - customHours * 3600;
  windowLabel = `最近 ${customHours} 小时`;
} else if (useYesterday) {
  const todayStart = beijingTodayStartSeconds();
  windowStartSec = todayStart - 86400;
  windowEndSec = todayStart;
  windowLabel = new Date((todayStart - 86400 + 8 * 3600) * 1000).toISOString().slice(0, 10);
} else {
  windowStartSec = beijingTodayStartSeconds();
  windowEndSec = now;
  windowLabel = beijingDateString();
}

// ═══════════════════════════════════════════════════════
// 数据源连接
// ═══════════════════════════════════════════════════════

const DATA_DIR = path.resolve(process.cwd(), 'data');
const sqlite = new Database(path.join(DATA_DIR, 'cards.db'), { readonly: true });

function readEnvVarFromDotenv(key: string): string {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return '';
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    if (k !== key) continue;
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return '';
}

function parseGoMysqlDsn(dsn: string): mysql.PoolOptions {
  if (dsn.startsWith('mysql://')) {
    const u = new URL(dsn);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }

  const m = /^([^:]+):(.*)@tcp\(([^)]+)\)\/([^?]+)(?:\?(.*))?$/.exec(dsn);
  if (!m) throw new Error('NEWAPI_SQL_DSN 格式错误,需为 mysql://... 或 Go MySQL DSN');
  const [, user, password, hostPort, database] = m;
  const idx = hostPort.lastIndexOf(':');
  const host = idx >= 0 ? hostPort.slice(0, idx) : hostPort;
  const port = idx >= 0 ? Number(hostPort.slice(idx + 1)) : 3306;
  return { host, port, user, password, database };
}

let mysqlPool: mysql.Pool | null = null;
async function getMysql(): Promise<mysql.Pool> {
  if (mysqlPool) return mysqlPool;
  const dsn = process.env.NEWAPI_SQL_DSN || process.env.SQL_DSN || readEnvVarFromDotenv('NEWAPI_SQL_DSN') || readEnvVarFromDotenv('SQL_DSN');
  if (!dsn) throw new Error('NEWAPI_SQL_DSN 未配置');
  mysqlPool = mysql.createPool({ ...parseGoMysqlDsn(dsn), waitForConnections: true, connectionLimit: 3 });
  return mysqlPool;
}

// ═══════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════

interface CardRow {
  id: number;
  code: string;
  category: string | null;
  plan: string;
  plan_days: number;
  status: string;
  activated_at: number | null;
  expires_at: number | null;
  newapi_token_id: number | null;
  newapi_token_key: string | null;
  rph: number;
  rph_bonus: number;
  disable_reason: string | null;
  pool: string | null;
  request_quota: number | null;
  request_bonus_quota: number;
  video_quota: number;
  video_bonus_quota: number;
}

interface QuotaRow {
  token_id: number;
  request_count: number;
  total_quota: number;
}

interface ReqCountRow {
  card_id: number;
  total: number;
  success: number;
  failed: number;
  top_model: string | null;
  top_ip: string | null;
}

interface ConcurrencyRow {
  card_id: number;
  minute_bucket: number;
  cnt: number;
}

interface ErrorRow {
  card_id: number;
  total: number;
  failed: number;
  top_status: number;
  top_status_count: number;
}

interface NewApiTokenRow {
  id: number;
  status: number;
  name: string;
  allow_ips: string;
  remain_quota: number;
  unlimited_quota: number;
  used_quota: number;
  expired_time: number;
}

interface BypassRiskItem {
  token_id: number;
  card_code: string;
  category: string;
  plan: string;
  newapi_req_count: number;
  nassa_req_count: number;
  allow_ips: string;
  risk: 'bypass_suspected' | 'historical' | 'none';
}

interface DisabledTokenRisk {
  card_code: string;
  token_id: number;
  token_status: number;
  today_requests: number;
  allow_ips: string;
}

interface QuotaWarningItem {
  card_code: string;
  plan: string;
  quota_type: string;
  used: number;
  limit: number;
  pct: number;
}

interface ReportSection {
  label: string;
  items: Record<string, unknown>[];
}

interface DailyReport {
  date: string;
  window_start: number;
  window_end: number;
  window_label: string;
  overview: {
    total_requests: number;
    success_count: number;
    failed_count: number;
    success_rate: number;
    total_quota: number;
    total_usd: number;
    active_cards: number;
  };
  top_quota: QuotaRow[];
  top_requests: ReqCountRow[];
  top_concurrency: { card_id: number; code: string; plan: string; category: string; peak_rpm: number; peak_time: string; risk_level: string }[];
  top_errors: ErrorRow[];
  bypass_risks: BypassRiskItem[];
  disabled_token_risks: DisabledTokenRisk[];
  allow_ips_stats: { total_tokens: number; allow_ips_empty: number; allow_ips_bound: number; allow_ips_anomaly: number };
  quota_warnings: QuotaWarningItem[];
  risk_summary: string[];
}

// ═══════════════════════════════════════════════════════
// 查询函数
// ═══════════════════════════════════════════════════════

/** 所有激活卡(含今日过期) */
function getActiveCards(): CardRow[] {
  const cutoff = windowStartSec - 86400; // 允许24小时前仍活跃的卡
  return sqlite.prepare(`
    SELECT * FROM cards
    WHERE status IN ('activated', 'expired', 'disabled')
      AND (expires_at IS NULL OR expires_at >= ?)
    ORDER BY id
  `).all(cutoff) as CardRow[];
}

/** 构建 token_id → cards 索引 */
function buildTokenCardMap(cards: CardRow[]): Map<number, CardRow> {
  const map = new Map<number, CardRow>();
  for (const c of cards) {
    if (c.newapi_token_id && !map.has(c.newapi_token_id)) {
      map.set(c.newapi_token_id, c);
    }
  }
  return map;
}

/** 构建 card_id → card 索引 */
function buildCardIdMap(cards: CardRow[]): Map<number, CardRow> {
  const map = new Map<number, CardRow>();
  for (const c of cards) map.set(c.id, c);
  return map;
}

/** 1. 今日消耗 Top 10 — NewAPI logs */
async function queryTopQuota(): Promise<QuotaRow[]> {
  const pool = await getMysql();
  const [rows] = await pool.query(
    `SELECT token_id, COUNT(*) as request_count, COALESCE(SUM(quota), 0) as total_quota
     FROM logs
     WHERE created_at >= ? AND created_at < ?
     GROUP BY token_id
     HAVING total_quota > 0
     ORDER BY total_quota DESC
     LIMIT 10`,
    [windowStartSec, windowEndSec],
  );
  return (rows as any[]).map((r) => ({
    token_id: Number(r.token_id),
    request_count: Number(r.request_count),
    total_quota: Number(r.total_quota),
  }));
}

/** 2. 今日请求次数 Top 10 — nassa request_logs */
function queryTopRequests(): ReqCountRow[] {
  return (sqlite.prepare(`
    SELECT
      rl.card_id,
      COUNT(*) as total,
      SUM(CASE WHEN rl.status >= 200 AND rl.status < 400 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN rl.status < 200 OR rl.status >= 400 THEN 1 ELSE 0 END) as failed,
      (SELECT rl2.model FROM request_logs rl2
       WHERE rl2.card_id = rl.card_id AND rl2.ts >= ? AND rl2.ts < ?
       GROUP BY rl2.model ORDER BY COUNT(*) DESC LIMIT 1) as top_model,
      '' as top_ip
    FROM request_logs rl
    WHERE rl.ts >= ? AND rl.ts < ?
    GROUP BY rl.card_id
    ORDER BY total DESC
    LIMIT 10
  `).all(windowStartSec, windowEndSec, windowStartSec, windowEndSec) as any[]).map((r) => ({
    card_id: Number(r.card_id),
    total: Number(r.total),
    success: Number(r.success),
    failed: Number(r.failed),
    top_model: r.top_model || null,
    top_ip: r.top_ip || null,
  }));
}

/** 3. 今日并发 Top 10 — 分钟桶近似 */
function queryTopConcurrency(): { card_id: number; peak_rpm: number; peak_bucket: number }[] {
  // 按 10 秒桶聚合每个卡在该桶内的请求数, 取每卡最高值 → 乘以 6 = 峰值 RPM 近似
  const bucketSize = 10;
  const rows = sqlite.prepare(`
    SELECT card_id, (ts / ?) as bucket, COUNT(*) as cnt
    FROM request_logs
    WHERE ts >= ? AND ts < ?
    GROUP BY card_id, bucket
    ORDER BY cnt DESC
    LIMIT 200
  `).all(bucketSize, windowStartSec, windowEndSec) as { card_id: number; bucket: number; cnt: number }[];

  const peakByCard = new Map<number, { peak_rpm: number; peak_bucket: number }>();
  for (const r of rows) {
    const rpm = r.cnt * (60 / bucketSize); // 归一化到分钟
    const existing = peakByCard.get(r.card_id);
    if (!existing || rpm > existing.peak_rpm) {
      peakByCard.set(r.card_id, { peak_rpm: rpm, peak_bucket: r.bucket });
    }
  }

  return Array.from(peakByCard.entries())
    .map(([card_id, v]) => ({ card_id, peak_rpm: v.peak_rpm, peak_bucket: v.peak_bucket }))
    .sort((a, b) => b.peak_rpm - a.peak_rpm)
    .slice(0, 10);
}

function concurrencyRisk(peakRpm: number): string {
  if (peakRpm >= 50) return '严重';
  if (peakRpm >= 20) return '高';
  if (peakRpm >= 5) return '中';
  return '低';
}

/** 4. 今日错误率 Top 10 */
function queryTopErrors(): ErrorRow[] {
  return (sqlite.prepare(`
    SELECT
      card_id,
      COUNT(*) as total,
      SUM(CASE WHEN status >= 400 OR status < 200 THEN 1 ELSE 0 END) as failed,
      0 as top_status,
      0 as top_status_count
    FROM request_logs
    WHERE ts >= ? AND ts < ?
    GROUP BY card_id
    HAVING failed > 0
    ORDER BY (CAST(failed AS REAL) / total) DESC
    LIMIT 10
  `).all(windowStartSec, windowEndSec) as any[]).map((r) => ({
    card_id: Number(r.card_id),
    total: Number(r.total),
    failed: Number(r.failed),
    top_status: 0,
    top_status_count: 0,
  }));
}

/** 5. 疑似绕过检测 */
async function queryBypassRisks(cards: CardRow[]): Promise<BypassRiskItem[]> {
  const pool = await getMysql();
  const results: BypassRiskItem[] = [];

  // 5a. 查 allow_ips 为空的 token 在 NewAPI 的请求
  const emptyIpsTokens = cards.filter(
    (c) => c.newapi_token_id && c.status === 'activated',
  );
  const tokenIds = emptyIpsTokens.map((c) => c.newapi_token_id!).filter(Boolean);

  if (tokenIds.length === 0) return results;

  // batch check allow_ips
  const placeholders = tokenIds.map(() => '?').join(',');
  const [tokenRows] = await pool.query(
    `SELECT id, allow_ips FROM tokens WHERE id IN (${placeholders}) AND (allow_ips = '' OR allow_ips IS NULL)`,
    tokenIds,
  );
  const emptyIpsTokenIds = new Set((tokenRows as any[]).map((t: any) => t.id));

  // 5b. NewAPI logs 有请求, 但 nassa request_logs 无记录
  for (const card of cards) {
    if (!card.newapi_token_id) continue;

    // NewAPI 今日请求数
    const [newapiRows] = await pool.query(
      `SELECT COUNT(*) as cnt FROM logs
       WHERE token_id = ? AND created_at >= ? AND created_at < ?`,
      [card.newapi_token_id, windowStartSec, windowEndSec],
    );
    const newapiCnt = Number((newapiRows as any[])[0]?.cnt || 0);

    // nassa 今日请求数
    const nassaRow = sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM request_logs WHERE card_id = ? AND ts >= ? AND ts < ?`,
    ).get(card.id, windowStartSec, windowEndSec) as { cnt: number };
    const nassaCnt = nassaRow?.cnt || 0;

    const ipsEmpty = emptyIpsTokenIds.has(card.newapi_token_id);
    let risk: BypassRiskItem['risk'] = 'none';
    if (newapiCnt > 0 && nassaCnt === 0) {
      risk = ipsEmpty ? 'bypass_suspected' : 'historical';
    }

    if (newapiCnt > 0 || ipsEmpty) {
      results.push({
        token_id: card.newapi_token_id,
        card_code: maskCard(card.code),
        category: card.category || '?',
        plan: card.plan,
        newapi_req_count: newapiCnt,
        nassa_req_count: nassaCnt,
        allow_ips: ipsEmpty ? '(空)' : maskAllowIps('172.18.0.1/32'),
        risk,
      });
    }
  }

  return results.sort((a, b) => b.newapi_req_count - a.newapi_req_count).slice(0, 10);
}

/** 6. disabled 卡仍有 NewAPI 请求 */
async function queryDisabledTokenRisks(): Promise<DisabledTokenRisk[]> {
  const disabledCards = sqlite.prepare(
    `SELECT code, newapi_token_id FROM cards
     WHERE status = 'disabled' AND newapi_token_id IS NOT NULL`,
  ).all() as { code: string; newapi_token_id: number }[];

  if (disabledCards.length === 0) return [];

  const pool = await getMysql();
  const results: DisabledTokenRisk[] = [];

  for (const card of disabledCards) {
    const [tokenRows] = await pool.query(
      `SELECT id, status, allow_ips FROM tokens WHERE id = ? AND status = 1`,
      [card.newapi_token_id],
    );
    const tokenActive = (tokenRows as any[]).length > 0;

    const [logRows] = await pool.query(
      `SELECT COUNT(*) as cnt FROM logs
       WHERE token_id = ? AND created_at >= ? AND created_at < ?`,
      [card.newapi_token_id, windowStartSec, windowEndSec],
    );
    const todayReqs = Number((logRows as any[])[0]?.cnt || 0);

    if (tokenActive || todayReqs > 0) {
      results.push({
        card_code: maskCard(card.code),
        token_id: card.newapi_token_id,
        token_status: 1,
        today_requests: todayReqs,
        allow_ips: maskAllowIps((tokenRows as any[])[0]?.allow_ips || '?'),
      });
    }
  }

  return results;
}

/** 7. allow_ips 整体统计 */
async function queryAllowIpsStats(cards: CardRow[]): Promise<DailyReport['allow_ips_stats']> {
  const uniqueTokenIds = new Set(cards.filter((c) => c.newapi_token_id).map((c) => c.newapi_token_id!));
  if (uniqueTokenIds.size === 0) {
    return { total_tokens: 0, allow_ips_empty: 0, allow_ips_bound: 0, allow_ips_anomaly: 0 };
  }

  const pool = await getMysql();
  const placeholders = Array.from(uniqueTokenIds).map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id, allow_ips FROM tokens WHERE id IN (${placeholders})`,
    Array.from(uniqueTokenIds),
  );

  const stats = { total_tokens: uniqueTokenIds.size, allow_ips_empty: 0, allow_ips_bound: 0, allow_ips_anomaly: 0 };
  for (const row of rows as any[]) {
    const ips = (row.allow_ips || '').trim();
    if (!ips) {
      stats.allow_ips_empty++;
    } else if (ips === '172.18.0.1/32') {
      stats.allow_ips_bound++;
    } else {
      stats.allow_ips_anomaly++;
    }
  }
  // 未查到的 token 也算在"未知"里,不额外分类
  return stats;
}

/** 8. 额度接近上限 */
function queryQuotaWarnings(cards: CardRow[]): QuotaWarningItem[] {
  const warnings: QuotaWarningItem[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  // 30d_light weighted points
  const lightCards = cards.filter((c) => c.plan === '30d_light' && c.activated_at);
  for (const card of lightCards) {
    const used24h = sqlite.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN rl.model = 'deepseek-v4-pro' THEN 3
          ELSE 1
        END
      ), 0) as pts
      FROM request_logs rl
      WHERE rl.card_id = ? AND rl.ts >= ? AND rl.status >= 200 AND rl.status < 400
    `).get(card.id, nowSec - 24 * 3600) as { pts: number };

    const used7d = sqlite.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN rl.model = 'deepseek-v4-pro' THEN 3
          ELSE 1
        END
      ), 0) as pts
      FROM request_logs rl
      WHERE rl.card_id = ? AND rl.ts >= ? AND rl.status >= 200 AND rl.status < 400
    `).get(card.id, nowSec - 7 * 24 * 3600) as { pts: number };

    const usedTotal = sqlite.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN rl.model = 'deepseek-v4-pro' THEN 3
          ELSE 1
        END
      ), 0) as pts
      FROM request_logs rl
      WHERE rl.card_id = ? AND rl.ts >= ? AND rl.status >= 200 AND rl.status < 400
    `).get(card.id, card.activated_at) as { pts: number };

    if (used24h.pts >= 1600) warnings.push({ card_code: maskCard(card.code), plan: '30d_light', quota_type: '24h点数', used: used24h.pts, limit: 2000, pct: Math.round((used24h.pts / 2000) * 100) });
    if (used7d.pts >= 8000) warnings.push({ card_code: maskCard(card.code), plan: '30d_light', quota_type: '7d点数', used: used7d.pts, limit: 10000, pct: Math.round((used7d.pts / 10000) * 100) });
    if (usedTotal.pts >= 32000) warnings.push({ card_code: maskCard(card.code), plan: '30d_light', quota_type: '总点数', used: usedTotal.pts, limit: 40000, pct: Math.round((usedTotal.pts / 40000) * 100) });
  }

  // GLM 1d request quota
  const glmCards = cards.filter((c) => c.category === 'glm' && c.plan === '1d' && c.activated_at);
  for (const card of glmCards) {
    const used = sqlite.prepare(`
      SELECT COUNT(*) as cnt FROM request_logs
      WHERE card_id = ? AND ts >= ? AND status >= 200 AND status < 400
    `).get(card.id, card.activated_at) as { cnt: number };
    const baseQuota = card.request_quota ?? 500;
    const effectiveQuota = baseQuota + (card.request_bonus_quota || 0);
    const pct = Math.round((used.cnt / effectiveQuota) * 100);
    if (pct >= 80) {
      warnings.push({ card_code: maskCard(card.code), plan: 'GLM 1d', quota_type: '总请求次数', used: used.cnt, limit: effectiveQuota, pct });
    }
  }

  return warnings.sort((a, b) => b.pct - a.pct).slice(0, 10);
}

/** 总体概况 */
function queryOverview(): DailyReport['overview'] {
  const totalRow = sqlite.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status >= 200 AND status < 400 THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN status < 200 OR status >= 400 THEN 1 ELSE 0 END) as failed
    FROM request_logs
    WHERE ts >= ? AND ts < ?
  `).get(windowStartSec, windowEndSec) as { total: number; success: number; failed: number };

  const total = Number(totalRow.total) || 0;
  const success = Number(totalRow.success) || 0;
  const failed = Number(totalRow.failed) || 0;

  const activeCards = (sqlite.prepare(
    `SELECT COUNT(DISTINCT card_id) as cnt FROM request_logs WHERE ts >= ? AND ts < ?`,
  ).get(windowStartSec, windowEndSec) as { cnt: number }).cnt;

  return {
    total_requests: total,
    success_count: success,
    failed_count: failed,
    success_rate: total > 0 ? Math.round((success / total) * 1000) / 10 : 100,
    total_quota: 0, // filled after MySQL query
    total_usd: 0,
    active_cards: activeCards,
  };
}

// ═══════════════════════════════════════════════════════
// 格式化输出
// ═══════════════════════════════════════════════════════

function formatHuman(report: DailyReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('【Nassa 每日用量风控日报】');
  lines.push(`日期：${report.date}`);
  lines.push(`窗口：${report.window_label}`);
  lines.push('');

  // 总体概况
  lines.push('一、总体概况');
  lines.push(`总请求：${report.overview.total_requests.toLocaleString()}`);
  lines.push(`成功：${report.overview.success_count.toLocaleString()}`);
  lines.push(`失败：${report.overview.failed_count.toLocaleString()}`);
  lines.push(`成功率：${report.overview.success_rate}%`);
  lines.push(`NewAPI 总消耗：${fmtLargeNum(report.overview.total_quota)} quota ≈ ${fmtUsd(report.overview.total_quota)}`);
  lines.push(`活跃卡数：${report.overview.active_cards}`);
  lines.push(`异常卡数：${report.disabled_token_risks.length + report.bypass_risks.filter((b) => b.risk === 'bypass_suspected').length}`);
  lines.push('');

  // 今日消耗 Top 5
  if (report.top_quota.length > 0) {
    lines.push('二、今日消耗 Top 5');
    for (let i = 0; i < Math.min(5, report.top_quota.length); i++) {
      const q = report.top_quota[i];
      const card = (report as any)._tokenCardMap?.get(q.token_id);
      const code = card ? maskCard(card.code) : `token#${q.token_id}`;
      lines.push(`${i + 1}. ${code}｜${fmtUsd(q.total_quota)}｜${q.request_count.toLocaleString()} 次`);
    }
    lines.push('');
  }

  // 请求次数 Top 5
  if (report.top_requests.length > 0) {
    lines.push('三、今日请求次数 Top 5');
    const cardIdMap = (report as any)._cardIdMap as Map<number, CardRow> | undefined;
    for (let i = 0; i < Math.min(5, report.top_requests.length); i++) {
      const r = report.top_requests[i];
      const card = cardIdMap?.get(r.card_id);
      const code = card ? maskCard(card.code) : `card#${r.card_id}`;
      lines.push(`${i + 1}. ${code}｜${r.total.toLocaleString()} 次｜成功 ${r.success}|失败 ${r.failed}`);
    }
    lines.push('');
  }

  // 并发 Top 5
  if (report.top_concurrency.length > 0) {
    lines.push('四、并发异常 Top 5');
    for (let i = 0; i < Math.min(5, report.top_concurrency.length); i++) {
      const c = report.top_concurrency[i];
      if (c.peak_rpm < 5) continue;
      lines.push(`${i + 1}. ${c.code}｜峰值 ${c.peak_rpm} 次/分钟｜风险：${c.risk_level}`);
    }
    lines.push('');
  }

  // 错误率 Top 5
  if (report.top_errors.length > 0) {
    lines.push('五、错误率 Top 5');
    const cardIdMap = (report as any)._cardIdMap as Map<number, CardRow> | undefined;
    for (let i = 0; i < Math.min(5, report.top_errors.length); i++) {
      const e = report.top_errors[i];
      const card = cardIdMap?.get(e.card_id);
      const code = card ? maskCard(card.code) : `card#${e.card_id}`;
      const pct = Math.round((e.failed / e.total) * 1000) / 10;
      lines.push(`${i + 1}. ${code}｜失败率 ${pct}%｜${e.failed}/${e.total} 次`);
    }
    lines.push('');
  }

  // 安全检查
  lines.push('六、安全检查');
  lines.push(`allow_ips 为空：${report.allow_ips_stats.allow_ips_empty}`);
  lines.push(`allow_ips 异常：${report.allow_ips_stats.allow_ips_anomaly}`);
  lines.push(`disabled 卡 token 仍启用：${report.disabled_token_risks.length}`);
  if (report.disabled_token_risks.length > 0) {
    const shown = report.disabled_token_risks.slice(0, 5);
    for (const r of shown) {
      lines.push(`  ⚠️ ${r.card_code}｜token_id=${r.token_id}｜今日请求=${r.today_requests}`);
    }
    if (report.disabled_token_risks.length > shown.length) {
      lines.push(`  ... 另有 ${report.disabled_token_risks.length - shown.length} 个,详见 --json 输出`);
    }
  }
  const bypassCount = report.bypass_risks.filter((b) => b.risk === 'bypass_suspected').length;
  lines.push(`疑似绕过：${bypassCount}`);
  if (bypassCount > 0) {
    const shown = report.bypass_risks.filter((b) => b.risk === 'bypass_suspected').slice(0, 5);
    for (const r of shown) {
      lines.push(`  ⚠️ ${r.card_code}｜NewAPI ${r.newapi_req_count} 次｜nassa ${r.nassa_req_count} 次`);
    }
    if (bypassCount > shown.length) {
      lines.push(`  ... 另有 ${bypassCount - shown.length} 个,详见 --json 输出`);
    }
  }
  lines.push('');

  // 额度预警
  if (report.quota_warnings.length > 0) {
    lines.push('七、额度预警');
    for (let i = 0; i < Math.min(5, report.quota_warnings.length); i++) {
      const w = report.quota_warnings[i];
      lines.push(`${i + 1}. ${w.card_code}｜${w.quota_type}：${w.used}/${w.limit}（${w.pct}%）`);
    }
    lines.push('');
  }

  // 结论
  const highRisks: string[] = [];
  if (report.top_concurrency.some((c) => c.peak_rpm >= 50)) highRisks.push('高并发');
  if (bypassCount > 0) highRisks.push('疑似绕过');
  if (report.disabled_token_risks.length > 0) highRisks.push('disabled token 仍活跃');
  if (report.allow_ips_stats.allow_ips_empty > 0) highRisks.push('allow_ips 为空');

  lines.push('结论：');
  if (highRisks.length > 0) {
    lines.push(`今日主要风险为 ${highRisks.join('、')}。`);
  } else {
    lines.push('今日未发现严重风险。');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

async function main() {
  // 预加载卡片
  const allCards = getActiveCards();
  const tokenCardMap = buildTokenCardMap(allCards);
  const cardIdMap = buildCardIdMap(allCards);

  // 并行查询
  const [quotaRows, reqRows, concRows, errRows, overview, disabledRisks, quotaWarnings] = await Promise.all([
    queryTopQuota().catch((e) => { console.error('quota query failed:', e.message); return [] as QuotaRow[]; }),
    Promise.resolve(queryTopRequests()),
    Promise.resolve(queryTopConcurrency()),
    Promise.resolve(queryTopErrors()),
    Promise.resolve(queryOverview()),
    queryDisabledTokenRisks().catch((e) => { console.error('disabled check failed:', e.message); return [] as DisabledTokenRisk[]; }),
    Promise.resolve(queryQuotaWarnings(allCards)),
  ]);

  const bypassRisks = await queryBypassRisks(allCards).catch((e) => { console.error('bypass check failed:', e.message); return [] as BypassRiskItem[]; });
  const allowIpsStats = await queryAllowIpsStats(allCards).catch((e) => { console.error('allow_ips check failed:', e.message); return { total_tokens: 0, allow_ips_empty: 0, allow_ips_bound: 0, allow_ips_anomaly: 0 }; });

  // 计算总体 quota
  const totalQuota = quotaRows.reduce((sum, q) => sum + q.total_quota, 0);
  overview.total_quota = totalQuota;
  overview.total_usd = quotaToUsd(totalQuota);

  // 并发详情
  const concDetails = concRows.map((c) => {
    const card = cardIdMap.get(c.card_id);
    return {
      card_id: c.card_id,
      code: card ? maskCard(card.code) : `card#${c.card_id}`,
      plan: card?.plan || '?',
      category: card?.category || '?',
      peak_rpm: c.peak_rpm,
      peak_time: new Date(c.peak_bucket * 10 * 1000).toISOString().slice(11, 19),
      risk_level: concurrencyRisk(c.peak_rpm),
    };
  });

  // 风险汇总
  const riskSummary: string[] = [];
  if (disabledRisks.length > 0) riskSummary.push(`disabled 卡 token 仍启用: ${disabledRisks.length} 张`);
  if (bypassRisks.filter((b) => b.risk === 'bypass_suspected').length > 0) riskSummary.push(`疑似绕过: ${bypassRisks.filter((b) => b.risk === 'bypass_suspected').length} 张`);
  if (allowIpsStats.allow_ips_empty > 0) riskSummary.push(`allow_ips 为空: ${allowIpsStats.allow_ips_empty} 个 token`);
  if (concDetails.some((c) => c.peak_rpm >= 50)) riskSummary.push('高并发卡');
  if (riskSummary.length === 0) riskSummary.push('无严重风险');

  const report: DailyReport = {
    date: beijingDateString(),
    window_start: windowStartSec,
    window_end: windowEndSec,
    window_label: windowLabel,
    overview,
    top_quota: quotaRows,
    top_requests: reqRows,
    top_concurrency: concDetails,
    top_errors: errRows,
    bypass_risks: bypassRisks,
    disabled_token_risks: disabledRisks,
    allow_ips_stats: allowIpsStats,
    quota_warnings: quotaWarnings,
    risk_summary: riskSummary,
  };

  // Attach card maps for formatting
  (report as any)._tokenCardMap = tokenCardMap;
  (report as any)._cardIdMap = cardIdMap;

  if (useJson) {
    // Strip internal maps
    const output: any = { ...report };
    delete output._tokenCardMap;
    delete output._cardIdMap;
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatHuman(report));
  }

  // Cleanup
  sqlite.close();
  if (mysqlPool) await mysqlPool.end();
}

main().catch((e) => {
  console.error('日报生成失败:', e.message);
  if (sqlite) sqlite.close();
  if (mysqlPool) mysqlPool.end().catch(() => {});
  process.exit(1);
});
