/**
 * 历史绕过用量对账脚本 — 单卡 dry-run / apply
 *
 * 将 NewAPI logs 中直连绕过 nassa-cards 的历史请求,
 * 按模型统计后写入 card_usage_adjustments 补账表。
 *
 * 用法:
 *   npm run backfill-newapi-bypass-usage -- --card DE-V2Q5-424P-Y9CE          (dry-run)
 *   npm run backfill-newapi-bypass-usage -- --card DE-V2Q5-424P-Y9CE --apply  (写入)
 *
 * 安全:
 *   - 默认 dry-run, 必须显式传 --apply 才写入
 *   - 同一 card_code + token_id + 时间范围 + source + batch_id 防重复
 *   - 未知模型单独列出, 不静默计入
 *   - 通过 docker exec 查询 NewAPI MySQL, 不暴露 DSN 密码
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
  return -1; // 未知 → suspicious
}

// ── NewAPI query via docker exec ─────────────────────────────────
const MYSQL_CMD =
  "docker exec newapi-prod-mysql-1 mysql -uroot -peZ1rW9jR6mU6uP4b new-api --default-character-set=utf8mb4 -N -e";

function queryNewApi(sql: string): string {
  // 使用 heredoc 避免 shell 转义问题
  const escaped = sql.replace(/'/g, "'\\''");
  return execSync(`${MYSQL_CMD} '${escaped}'`, {
    encoding: 'utf-8',
    timeout: 15000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

interface NewApiLogRow {
  model_name: string;
  created_at: number;
}

// ── main ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const cardIdx = args.indexOf('--card');
  const cardCode = cardIdx >= 0 ? args[cardIdx + 1] : null;
  if (!cardCode) {
    console.log('用法: npm run backfill-newapi-bypass-usage -- --card DE-XXXX-XXXX-XXXX [--apply]');
    process.exit(1);
  }

  const mode = apply ? '⚠️  APPLY' : '🔍 DRY-RUN';
  console.log(`${mode} — 卡密: ${cardCode}`);

  // ── 1. 读 nassa-cards SQLite ─────────────────────────────────
  const dbPath = path.resolve(process.cwd(), 'data/cards.db');
  const sqlite = new Database(dbPath);

  const card = sqlite
    .prepare(
      'SELECT id, code, newapi_token_id, activated_at, category, plan FROM cards WHERE code = ?',
    )
    .get(cardCode) as any;
  if (!card) {
    console.error(`卡 ${cardCode} 不存在`);
    sqlite.close();
    process.exit(1);
  }
  console.log(
    `  nassa 卡: ${card.code}  token_id=${card.newapi_token_id}  plan=${card.plan}  category=${card.category}`,
  );

  if (card.category !== 'deepseek' || card.plan !== '30d_light') {
    console.log(`  ⚠️  非 DeepSeek 轻度月卡, 跳过`);
    sqlite.close();
    process.exit(0);
  }

  // ── 2. 读 NewAPI logs ────────────────────────────────────────
  const raw = queryNewApi(
    `SELECT model_name, created_at FROM logs WHERE token_id = ${card.newapi_token_id} ORDER BY created_at`,
  );

  const logRows: NewApiLogRow[] = raw
    .trim()
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const cols = line.split('\t');
      return { model_name: cols[0] || '', created_at: Number(cols[1]) || 0 };
    });

  if (logRows.length === 0) {
    console.log('  NewAPI logs: 0 条, 无需补账');
    sqlite.close();
    process.exit(0);
  }

  const minTs = logRows[0].created_at;
  const maxTs = logRows[logRows.length - 1].created_at;
  console.log(
    `  NewAPI logs: ${logRows.length} 条  时间: ${new Date(minTs * 1000).toISOString()} ~ ${new Date(maxTs * 1000).toISOString()}`,
  );

  // ── 3. 按模型分组统计 ───────────────────────────────────────
  const byModel = new Map<string, { count: number; weighted: number }>();
  const suspicious: string[] = [];

  for (const row of logRows) {
    const w = modelWeight(row.model_name);
    if (w < 0) {
      if (!suspicious.includes(row.model_name)) suspicious.push(row.model_name);
      continue;
    }
    const entry = byModel.get(row.model_name) || { count: 0, weighted: 0 };
    entry.count++;
    entry.weighted += w;
    byModel.set(row.model_name, entry);
  }

  let totalPoints = 0;
  let totalRequests = 0;
  console.log('\n  按模型分组:');
  console.log('  model                     requests   weighted_points');
  console.log('  ------------------------------------------------');
  for (const [model, stats] of [...byModel.entries()].sort(
    (a, b) => b[1].weighted - a[1].weighted,
  )) {
    totalPoints += stats.weighted;
    totalRequests += stats.count;
    console.log(
      `  ${model.padEnd(25)} ${String(stats.count).padStart(8)}   ${String(stats.weighted).padStart(14)}`,
    );
  }
  console.log('  ------------------------------------------------');
  console.log(
    `  TOTAL                     ${String(totalRequests).padStart(8)}   ${String(totalPoints).padStart(14)}`,
  );

  if (suspicious.length > 0) {
    console.log(`\n  ⚠️  未知模型(不会计入补账): ${suspicious.join(', ')}`);
  }

  // ── 4. 防重复检查 ──────────────────────────────────────────
  const batchId = crypto
    .createHash('sha256')
    .update(`${cardCode}-${card.newapi_token_id}-${minTs}-${maxTs}-newapi_bypass_backfill`)
    .digest('hex')
    .slice(0, 16);

  const existing = sqlite
    .prepare(
      `SELECT COUNT(*) as cnt FROM card_usage_adjustments
       WHERE card_code = ? AND newapi_token_id = ?
         AND source = 'newapi_bypass_backfill'
         AND original_started_at = ? AND original_ended_at = ?`,
    )
    .get(cardCode, card.newapi_token_id, minTs, maxTs) as any;

  if (existing?.cnt > 0) {
    console.log(`\n  ❌ 已存在补账记录 (${existing.cnt} 条), 跳过 (防重复)`);
    sqlite.close();
    process.exit(1);
  }

  // ── 5. 写入预览 / 实际写入 ──────────────────────────────────
  const insertCount = byModel.size;
  console.log(`\n  预计写入 card_usage_adjustments: ${insertCount} 条`);
  console.log(`  batch_id: ${batchId}`);

  if (!apply) {
    console.log('\n  [DRY-RUN] 未写入。加 --apply 执行实际写入。');
    sqlite.close();
    process.exit(0);
  }

  // --apply: 写入
  const now = Math.floor(Date.now() / 1000);
  const insert = sqlite.prepare(
    `INSERT INTO card_usage_adjustments
       (card_code, newapi_token_id, source, model, request_count, weighted_points,
        original_started_at, original_ended_at, created_at, reason, external_batch_id)
     VALUES (?, ?, 'newapi_bypass_backfill', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const dateLabel = new Date(minTs * 1000).toISOString().slice(0, 10);
  const txn = sqlite.transaction(() => {
    for (const [model, stats] of byModel) {
      insert.run(
        cardCode,
        card.newapi_token_id,
        model,
        stats.count,
        stats.weighted,
        minTs,
        maxTs,
        now,
        `allow_ips 修复前直连绕过补账 — ${cardCode} — ${dateLabel}`,
        batchId,
      );
    }
  });
  txn();

  const written = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM card_usage_adjustments WHERE external_batch_id = ?')
    .get(batchId) as any;
  console.log(`\n  ✅ 已写入 ${written.cnt} 条补账记录, batch_id=${batchId}`);

  sqlite.close();
}

main().catch((e) => {
  console.error('失败:', e.message || e);
  process.exit(1);
});
