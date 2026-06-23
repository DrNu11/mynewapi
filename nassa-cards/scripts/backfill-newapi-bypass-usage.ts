/**
 * 历史绕过用量对账脚本 — 按 NewAPI logs 真实每日聚合
 *
 * 用法:
 *   npm run backfill-newapi-bypass-usage -- --card DE-V2Q5-424P-Y9CE              (dry-run)
 *   npm run backfill-newapi-bypass-usage -- --card DE-V2Q5-424P-Y9CE --apply      (写入按天记录)
 *   npm run backfill-newapi-bypass-usage -- --void-batch 1eff2afbe63c44f6         (void旧batch dry-run)
 *   npm run backfill-newapi-bypass-usage -- --void-batch 1eff2afbe63c44f6 --apply (void旧batch)
 *
 * stat_day: 北京时间(UTC+8)自然日, 与 result 页面 locatime 口径一致
 *
 * 安全:
 *   - 默认 dry-run
 *   - UNIQUE 索引防重复(card_code, token_id, model, stat_day, source, batch_id)
 *   - voided_at 标记废弃旧记录, 不物理删除
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

// ── helpers ──────────────────────────────────────────────────────
function mask(s: string): string {
  if (s.length <= 10) return '***';
  return s.slice(0, 6) + '****' + s.slice(-4);
}

function modelWeight(model: string | null): number {
  const m = (model || '').trim();
  if (m === 'deepseek-v4-pro') return 3;
  if (m === 'deepseek-v4-flash' || m === 'DeepSeek') return 1;
  return -1;
}

// ── NewAPI query via docker exec ─────────────────────────────────
const MYSQL_CMD =
  "docker exec newapi-prod-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api --default-character-set=utf8mb4 -N -e";

function queryNewApi(sql: string): string {
  const escaped = sql.replace(/'/g, "'\\''");
  return execSync(`${MYSQL_CMD} '${escaped}'`, {
    encoding: 'utf-8',
    timeout: 15000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

// ── main ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const cardIdx = args.indexOf('--card');
  const cardCode = cardIdx >= 0 ? args[cardIdx + 1] : null;
  const voidIdx = args.indexOf('--void-batch');
  const voidBatch = voidIdx >= 0 ? args[voidIdx + 1] : null;

  // ── 打开 SQLite ──────────────────────────────────────────────
  const dbPath = path.resolve(process.cwd(), 'data/cards.db');
  const sqlite = new Database(dbPath);

  // ── void 模式 ─────────────────────────────────────────────────
  if (voidBatch) {
    const mode = apply ? '⚠️  VOID APPLY' : '🔍 VOID DRY-RUN';
    console.log(`${mode} — batch: ${voidBatch}`);
    const existing = sqlite
      .prepare('SELECT id, card_code, model, request_count, weighted_points FROM card_usage_adjustments WHERE external_batch_id = ? AND voided_at IS NULL')
      .all(voidBatch) as any[];
    if (existing.length === 0) {
      console.log('  没有找到未 void 的记录');
      sqlite.close();
      process.exit(0);
    }
    console.log(`  找到 ${existing.length} 条记录:`);
    for (const r of existing) {
      console.log(`    ${r.card_code}  ${r.model.padEnd(20)}  ${r.request_count}次  ${r.weighted_points}点`);
    }
    if (!apply) {
      console.log('\n  [DRY-RUN] 加 --apply 执行 void。');
      sqlite.close();
      process.exit(0);
    }
    const now = Math.floor(Date.now() / 1000);
    sqlite.prepare('UPDATE card_usage_adjustments SET voided_at = ? WHERE external_batch_id = ? AND voided_at IS NULL').run(now, voidBatch);
    console.log(`\n  ✅ 已 void ${existing.length} 条记录`);
    sqlite.close();
    process.exit(0);
  }

  // ── 补账模式 ─────────────────────────────────────────────────
  if (!cardCode) {
    console.log('用法: npm run backfill-newapi-bypass-usage -- --card DE-XXXX-XXXX-XXXX [--apply]');
    console.log('      npm run backfill-newapi-bypass-usage -- --void-batch <batch_id> [--apply]');
    process.exit(1);
  }

  const mode = apply ? '⚠️  APPLY' : '🔍 DRY-RUN';
  console.log(`${mode} — 卡密: ${cardCode}`);

  const card = sqlite
    .prepare('SELECT id, code, newapi_token_id, activated_at, category, plan FROM cards WHERE code = ?')
    .get(cardCode) as any;
  if (!card) { console.error(`卡 ${cardCode} 不存在`); sqlite.close(); process.exit(1); }
  console.log(`  nassa 卡: ${card.code}  token_id=${card.newapi_token_id}  plan=${card.plan}`);

  if (card.category !== 'deepseek' || card.plan !== '30d_light') {
    console.log(`  ⚠️  非 DeepSeek 轻度月卡, 跳过`);
    sqlite.close();
    process.exit(0);
  }

  // ── 查询 NewAPI logs, 按北京时间 day + model 聚合 ────────────
  const raw = queryNewApi(
    `SELECT DATE_FORMAT(FROM_UNIXTIME(created_at + 28800), '%Y-%m-%d') AS day_bj,
            model_name,
            COUNT(*) AS cnt
     FROM logs WHERE token_id = ${card.newapi_token_id}
     GROUP BY day_bj, model_name
     ORDER BY day_bj, model_name`,
  );

  const dailyRows: Array<{ day: string; model: string; count: number }> = raw
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const cols = line.split('\t');
      return { day: cols[0], model: cols[1] || '', count: Number(cols[2]) || 0 };
    });

  if (dailyRows.length === 0) {
    console.log('  NewAPI logs: 0 条, 无需补账');
    sqlite.close();
    process.exit(0);
  }

  // 获取时间范围用于 original_started_at / original_ended_at
  const rangeRaw = queryNewApi(
    `SELECT MIN(created_at), MAX(created_at) FROM logs WHERE token_id = ${card.newapi_token_id}`,
  );
  const [minTs, maxTs] = rangeRaw.trim().split('\t').map(Number);

  console.log(`  NewAPI logs 每日聚合 (北京时间):`);
  console.log(`  stat_day      model                     requests   points`);
  console.log(`  --------------------------------------------------------`);

  // 按 day+model 汇总
  const byDayModel = new Map<string, { day: string; model: string; count: number; points: number }>();
  let totalReq = 0;
  let totalPts = 0;
  const suspicious: string[] = [];

  for (const r of dailyRows) {
    const w = modelWeight(r.model);
    if (w < 0) {
      if (!suspicious.includes(r.model)) suspicious.push(r.model);
      continue;
    }
    const key = `${r.day}|${r.model}`;
    const entry = byDayModel.get(key) || { day: r.day, model: r.model, count: 0, points: 0 };
    entry.count += r.count;
    entry.points += r.count * w;
    byDayModel.set(key, entry);
    totalReq += r.count;
    totalPts += r.count * w;
  }

  const sorted = [...byDayModel.values()].sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model));
  for (const r of sorted) {
    console.log(`  ${r.day}      ${r.model.padEnd(25)} ${String(r.count).padStart(5)}   ${String(r.points).padStart(7)}`);
  }
  console.log(`  --------------------------------------------------------`);
  console.log(`  TOTAL                             ${String(totalReq).padStart(5)}   ${String(totalPts).padStart(7)}`);

  if (suspicious.length > 0) {
    console.log(`\n  ⚠️  未知模型(不计入): ${suspicious.join(', ')}`);
  }

  // ── 防重复检查 ──────────────────────────────────────────────
  const batchId = crypto
    .createHash('sha256')
    .update(`${cardCode}-${card.newapi_token_id}-daily-${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

  // 检查是否已有未 void 的每日记录
  const existingDaily = sqlite
    .prepare(
      `SELECT COUNT(*) as cnt FROM card_usage_adjustments
       WHERE card_code = ? AND newapi_token_id = ?
         AND source = 'newapi_bypass_backfill'
         AND stat_day IS NOT NULL AND voided_at IS NULL`,
    )
    .get(cardCode, card.newapi_token_id) as any;

  if (existingDaily?.cnt > 0) {
    console.log(`\n  ❌ 已存在 ${existingDaily.cnt} 条未 void 的每日补账记录, 先 --void-batch 清理旧记录`);
    sqlite.close();
    process.exit(1);
  }

  console.log(`\n  预计写入: ${sorted.length} 条 (按天+模型)`);
  console.log(`  batch_id: ${batchId}`);

  if (!apply) {
    console.log('\n  [DRY-RUN] 未写入。加 --apply 执行。');
    sqlite.close();
    process.exit(0);
  }

  // ── apply: 写入 ─────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const insert = sqlite.prepare(
    `INSERT INTO card_usage_adjustments
       (card_code, newapi_token_id, source, model, request_count, weighted_points,
        original_started_at, original_ended_at, stat_day, created_at, reason, external_batch_id)
     VALUES (?, ?, 'newapi_bypass_backfill', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const txn = sqlite.transaction(() => {
    for (const r of sorted) {
      insert.run(
        cardCode, card.newapi_token_id, r.model, r.count, r.points,
        minTs, maxTs, r.day, now,
        `allow_ips 修复前直连绕过补账(按天) — ${cardCode}`,
        batchId,
      );
    }
  });
  txn();

  const written = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM card_usage_adjustments WHERE external_batch_id = ?')
    .get(batchId) as any;
  console.log(`\n  ✅ 已写入 ${written.cnt} 条每日补账记录, batch_id=${batchId}`);

  sqlite.close();
}

main().catch((e) => {
  console.error('失败:', e.message || e);
  process.exit(1);
});
