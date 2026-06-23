/**
 * 批量修复 NewAPI token allow_ips
 *
 * 用法:
 *   npm run fix-newapi-token-allow-ips -- --dry-run                (预览, 不修改)
 *   npm run fix-newapi-token-allow-ips -- --all --apply             (批量修复)
 *   npm run fix-newapi-token-allow-ips -- --card GP-XXXX-XXXX-XXXX --apply  (单卡修复)
 *
 * 安全要求:
 *   - 默认 dry-run, 必须传 --apply 才真正更新
 *   - 不修改 status / quota / model / channel
 *   - 不打印完整 token
 */

import mysql from 'mysql2/promise';

// ── env ──────────────────────────────────────────────────────────
function env(key: string, required = true): string {
  const v = process.env[key];
  if (required && !v) throw new Error(`Missing env: ${key}`);
  return v || '';
}

function mask(s: string): string {
  if (s.length <= 10) return '***';
  return s.slice(0, 6) + '****' + s.slice(-4);
}

// ── main ─────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const all = args.includes('--all');
  const cardIdx = args.indexOf('--card');
  const targetCard = cardIdx >= 0 ? args[cardIdx + 1] : null;

  const allowIps = process.env.NEWAPI_TOKEN_ALLOW_IPS || '172.18.0.1/32';

  if (!all && !targetCard) {
    console.log('用法:');
    console.log('  npm run fix-newapi-token-allow-ips -- --dry-run');
    console.log('  npm run fix-newapi-token-allow-ips -- --all --apply');
    console.log('  npm run fix-newapi-token-allow-ips -- --card GP-XXXX-XXXX-XXXX --apply');
    process.exit(1);
  }

  const dsn = process.env.NEWAPI_SQL_DSN;
  if (!dsn) throw new Error('NEWAPI_SQL_DSN 未配置');

  const pool = mysql.createPool({ uri: dsn, waitForConnections: true, connectionLimit: 1 });

  const mode = dryRun ? '🔍 DRY-RUN (不修改)' : '⚠️  APPLY (将修改)';
  console.log(`${mode}`);
  console.log(`allow_ips = ${allowIps}`);

  // 构建查询
  let query: string;
  let params: any[];
  if (targetCard) {
    query = `SELECT id, name, status, allow_ips FROM tokens WHERE name = ? AND status = 1 AND (allow_ips = '' OR allow_ips IS NULL)`;
    params = [targetCard];
  } else {
    query = `SELECT id, name, status, allow_ips FROM tokens WHERE (name LIKE 'DE-%' OR name LIKE 'GP-%' OR name LIKE 'CL-%') AND status = 1 AND (allow_ips = '' OR allow_ips IS NULL) ORDER BY id`;
    params = [];
  }

  const [rows] = (await pool.query(query, params)) as any;

  if (rows.length === 0) {
    console.log('没有需要修复的 token。');
    await pool.end();
    return;
  }

  console.log(`\n找到 ${rows.length} 个 token 需要修复:\n`);
  console.log('token_id  name                      status  allow_ips');
  console.log('-'.repeat(65));
  for (const r of rows) {
    console.log(
      `${String(r.id).padEnd(10)} ${mask(r.name).padEnd(25)} ${String(r.status).padEnd(8)} ${r.allow_ips || '(空)'}`,
    );
  }

  if (dryRun) {
    console.log(`\n[DRY-RUN] 将修改 ${rows.length} 个 token 的 allow_ips → "${allowIps}"`);
    console.log('加上 --apply 执行实际修改。');
  } else {
    // 逐个更新 (避免大事务锁表)
    let done = 0;
    let failed = 0;
    for (const r of rows) {
      try {
        await pool.query(`UPDATE tokens SET allow_ips = ? WHERE id = ?`, [allowIps, r.id]);
        done++;
      } catch (e: any) {
        failed++;
        console.error(`  ❌ token ${r.id} 更新失败: ${e.message}`);
      }
    }
    console.log(`\n✅ 完成: ${done} 个更新成功, ${failed} 个失败`);

    // 验证
    const [verify] = (await pool.query(
      `SELECT COUNT(*) as cnt FROM tokens WHERE (name LIKE 'DE-%' OR name LIKE 'GP-%' OR name LIKE 'CL-%') AND status = 1 AND (allow_ips = '' OR allow_ips IS NULL)`,
    )) as any;
    console.log(`剩余未修复: ${verify[0].cnt} 个`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error('失败:', e.message);
  process.exit(1);
});
