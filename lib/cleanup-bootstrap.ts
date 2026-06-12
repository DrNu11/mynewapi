/**
 * 后台定时清理任务 — 在 server 进程启动时引导
 *
 * 在 nassa-cards Node 进程内,通过 setInterval 每 6 小时跑一次:
 *   1. markExpiredCards()         — 把已到期的 cards.status 从 'activated' 标记为 'expired'
 *   2. pruneOldRequests(30 天)    — 删除 30 天前的 request_logs(限速观测用,不需要长期保留)
 *   3. pruneOldAudit(90 天)       — 删除 90 天前的 conversation_logs(审计需保留更久)
 *
 * 用 globalThis 防止 Next.js dev hot reload / Server Component 多实例重复启动。
 * 任何路由 import 此文件即触发引导(side effect)。
 */
import { pruneOldRequests, markExpiredCards } from './db';
import { pruneOldAudit } from './audit';

const SIX_HOURS_MS = 6 * 3600 * 1000;

interface CleanupGlobal {
  __nassaCleanupStarted?: boolean;
}

if (typeof window === 'undefined') {
  const g = globalThis as unknown as CleanupGlobal;
  if (!g.__nassaCleanupStarted) {
    g.__nassaCleanupStarted = true;
    // 启动 60s 后跑首次(避免抢占启动资源)
    setTimeout(runCleanup, 60_000);
    // 然后每 6 小时跑一次
    setInterval(runCleanup, SIX_HOURS_MS);
    console.log('[cleanup-bootstrap] cron 已启动:60s 后首次执行,之后每 6h');
  }
}

function runCleanup(): void {
  const start = Date.now();
  let expired = 0;
  let reqDel = 0;
  let auditDel = 0;

  try {
    expired = markExpiredCards();
  } catch (err) {
    console.error('[cleanup] markExpiredCards failed:', err);
  }
  try {
    reqDel = pruneOldRequests(30);
  } catch (err) {
    console.error('[cleanup] pruneOldRequests failed:', err);
  }
  try {
    auditDel = pruneOldAudit(90);
  } catch (err) {
    console.error('[cleanup] pruneOldAudit failed:', err);
  }

  // 仅在有事发生时打日志,避免每 6h 一条 noise
  if (expired + reqDel + auditDel > 0) {
    const ms = Date.now() - start;
    console.log(
      `[cleanup] 耗时 ${ms}ms · 卡密过期标记=${expired} · request_logs 清=${reqDel} · audit 清=${auditDel}`,
    );
  }
}
