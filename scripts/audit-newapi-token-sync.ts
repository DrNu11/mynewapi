/**
 * 只读巡检脚本 — 检测 nassa-cards 与 NewAPI token 同步状态
 *
 * 检查项:
 *   1. cards.status=disabled 但 NewAPI token.status=1 (绕过风险)
 *   2. NewAPI token.allow_ips 为空 (未绑定代理 IP)
 *   3. NewAPI logs 有请求但 nassa-cards request_logs 没有请求 (绕过嫌疑)
 *
 * 用法:
 *   npm run audit-newapi-token-sync
 *   npm run audit-newapi-token-sync -- --json   (JSON 输出)
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import * as path from 'path';
import * as fs from 'fs';

// ── env ──────────────────────────────────────────────────────────
function env(key: string, required = true): string {
  const v = process.env[key];
  if (required && !v) throw new Error(`Missing env: ${key}`);
  return v || '';
}

function maskKey(sk: string): string {
  if (sk.length <= 10) return '***';
  return sk.slice(0, 6) + '****' + sk.slice(-4);
}

// ── SQLite (nassa-cards) ─────────────────────────────────────────
const DB_PATH = path.resolve(process.cwd(), 'data/cards.db');
const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.pragma('journal_mode = WAL');

// ── MySQL (NewAPI) ───────────────────────────────────────────────
let mysqlPool: mysql.Pool | null = null;
async function getMysql(): Promise<mysql.Pool> {
  if (mysqlPool) return mysqlPool;
  const dsn = process.env.NEWAPI_SQL_DSN;
  if (!dsn) throw new Error('NEWAPI_SQL_DSN 未配置');
  mysqlPool = mysql.createPool({ uri: dsn, waitForConnections: true, connectionLimit: 2 });
  return mysqlPool;
}

// ── types ────────────────────────────────────────────────────────
interface RiskCard {
  card_code: string;
  category: string;
  plan: string;
  card_status: string;
  token_id: number | null;
  token_status: number | null;
  allow_ips: string;
  allow_ips_bound: boolean;
  newapi_req_24h: number;
  newapi_quota_24h: number;
  nassa_req_total: number;
  risk_flags: string[];
}

// ── main ─────────────────────────────────────────────────────────
async function main() {
  const useJson = process.argv.includes('--json');

  const risks: RiskCard[] = [];

  // 1. 找出 cards.status=disabled 但 NewAPI token.status=1 的卡
  const disabledCards = sqlite
    .prepare(
      `SELECT code, category, plan, status, newapi_token_id
       FROM cards WHERE status = 'disabled' AND newapi_token_id IS NOT NULL`,
    )
    .all() as any[];

  if (disabledCards.length > 0) {
    const pool = await getMysql();
    const tokenIds = disabledCards.map((c) => c.newapi_token_id).filter(Boolean);
    if (tokenIds.length > 0) {
      const placeholders = tokenIds.map(() => '?').join(',');
      const [rows] = (await pool.query(
        `SELECT id, status, allow_ips FROM tokens WHERE id IN (${placeholders}) AND status = 1`,
        tokenIds,
      )) as any;
      const activeTokenIds = new Set(rows.map((r: any) => r.id));
      for (const card of disabledCards) {
        if (activeTokenIds.has(card.newapi_token_id)) {
          risks.push({
            card_code: card.code,
            category: card.category || '?',
            plan: card.plan,
            card_status: 'disabled',
            token_id: card.newapi_token_id,
            token_status: 1,
            allow_ips: '',
            allow_ips_bound: false,
            newapi_req_24h: 0,
            newapi_quota_24h: 0,
            nassa_req_total: 0,
            risk_flags: ['card_disabled_but_token_active'],
          });
        }
      }
    }
  }

  // 2. 找出 allow_ips 为空 + status=1 的 nassa-cards token
  const pool = await getMysql();
  const [allTokens] = (await pool.query(
    `SELECT t.id, t.name, t.status, t.allow_ips,
            COUNT(l.id) as req_24h, COALESCE(SUM(l.quota), 0) as quota_24h
     FROM tokens t
     LEFT JOIN logs l ON l.token_id = t.id AND l.created_at >= UNIX_TIMESTAMP(NOW() - INTERVAL 24 HOUR)
     WHERE (t.name LIKE 'DE-%' OR t.name LIKE 'GP-%' OR t.name LIKE 'CL-%')
       AND t.status = 1
       AND (t.allow_ips = '' OR t.allow_ips IS NULL)
     GROUP BY t.id
     ORDER BY quota_24h DESC`,
  )) as any;

  // map token_name → nassa-cards card
  const tokenNames = (allTokens as any[]).map((t: any) => t.name);
  const cardMap = new Map<string, any>();
  if (tokenNames.length > 0) {
    const ph = tokenNames.map(() => '?').join(',');
    const cardRows = sqlite
      .prepare(
        `SELECT code, plan, category, status, newapi_token_id
         FROM cards WHERE code IN (${ph})`,
      )
      .all(...tokenNames) as any[];
    for (const c of cardRows) cardMap.set(c.code, c);
  }

  for (const t of allTokens as any[]) {
    const card = cardMap.get(t.name);
    const flags: string[] = ['allow_ips_empty'];
    if (card && card.status === 'disabled' && t.status === 1) {
      flags.push('card_disabled_but_token_active');
    }
    risks.push({
      card_code: t.name,
      category: card?.category || '?',
      plan: card?.plan || '?',
      card_status: card?.status || 'unknown',
      token_id: t.id,
      token_status: t.status,
      allow_ips: t.allow_ips || '(空)',
      allow_ips_bound: false,
      newapi_req_24h: Number(t.req_24h),
      newapi_quota_24h: Number(t.quota_24h),
      nassa_req_total: 0,
      risk_flags: flags,
    });
  }

  // 3. 找出 NewAPI logs 有大量请求但 nassa request_logs 为 0 的卡(绕过嫌疑)
  const highTrafficTokens = risks.filter((r) => r.newapi_req_24h > 100);
  for (const r of highTrafficTokens) {
    const nassaReqs = sqlite
      .prepare(`SELECT COUNT(*) as cnt FROM request_logs WHERE card_id = (SELECT id FROM cards WHERE code = ?)`)
      .get(r.card_code) as any;
    r.nassa_req_total = nassaReqs?.cnt || 0;
    if (r.nassa_req_total === 0 && r.newapi_req_24h > 100) {
      r.risk_flags.push('newapi_has_traffic_but_nassa_none');
    }
  }

  // 去重(同一 token 可能被多次检测)
  const seen = new Set<number>();
  const deduped = risks.filter((r) => {
    if (!r.token_id || seen.has(r.token_id)) return false;
    seen.add(r.token_id);
    return true;
  });

  // 排序: 高风险优先
  deduped.sort((a, b) => {
    const aHigh = a.risk_flags.length;
    const bHigh = b.risk_flags.length;
    if (bHigh !== aHigh) return bHigh - aHigh;
    return b.newapi_quota_24h - a.newapi_quota_24h;
  });

  // ── output ───────────────────────────────────────────────────
  if (useJson) {
    const safe = deduped.map((r) => ({ ...r }));
    console.log(JSON.stringify(safe, null, 2));
  } else {
    const highRisk = deduped.filter((r) => r.risk_flags.length >= 2);
    const lowRisk = deduped.filter((r) => r.risk_flags.length < 2);

    console.log(`\n🔴 高风险 (${highRisk.length} 个):`);
    console.log('card_code          category  plan   card_st    tok_st  allow_ips   req_24h    quota_24h    flags');
    console.log('-'.repeat(120));
    for (const r of highRisk.slice(0, 40)) {
      const quotaFmt = r.newapi_quota_24h > 1_000_000
        ? `${(r.newapi_quota_24h / 1_000_000).toFixed(0)}M`
        : String(r.newapi_quota_24h);
      console.log(
        `${r.card_code.padEnd(20)} ${r.category.padEnd(8)} ${r.plan.padEnd(6)} ${r.card_status.padEnd(10)} ${String(r.token_status).padEnd(8)} ${String(r.allow_ips_bound ? 'bound' : 'EMPTY').padEnd(12)} ${String(r.newapi_req_24h).padEnd(10)} ${quotaFmt.padEnd(12)} ${r.risk_flags.join(', ')}`,
      );
    }

    console.log(`\n🟡 低风险 — allow_ips 为空但无其他异常 (${lowRisk.length} 个):`);
    const topLow = lowRisk
      .sort((a, b) => b.newapi_quota_24h - a.newapi_quota_24h)
      .slice(0, 20);
    for (const r of topLow) {
      const quotaFmt = r.newapi_quota_24h > 1_000_000
        ? `${(r.newapi_quota_24h / 1_000_000).toFixed(0)}M`
        : String(r.newapi_quota_24h);
      console.log(
        `${r.card_code.padEnd(20)} ${r.category.padEnd(8)} ${r.plan.padEnd(6)} req_24h=${String(r.newapi_req_24h).padEnd(8)} quota_24h=${quotaFmt}`,
      );
    }

    console.log(`\n总计: ${deduped.length} 个 token 需要关注`);
    console.log(`  高风险: ${highRisk.length} (card disabled but token active / traffic bypass)`);
    console.log(`  低风险: ${lowRisk.length} (allow_ips 为空, 无其他异常)`);
  }

  sqlite.close();
  if (mysqlPool) await mysqlPool.end();
}

main().catch((e) => {
  console.error('巡检失败:', e.message);
  process.exit(1);
});
