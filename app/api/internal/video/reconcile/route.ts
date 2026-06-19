import { NextRequest, NextResponse } from 'next/server';
import { getStaleVideoTasks, getUncertainOperations, getPendingInviteSettlementTasks, getRecoverableUncertainOperations, recoverUncertainSubmission, releaseExpiredReservations } from '@/lib/db';
import { syncVideoTask } from '@/lib/video-sync';
import { settleInviteReward } from '@/lib/invite-reward';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, message: 'INTERNAL_CRON_SECRET 未配置' }, { status: 500 });
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
  }

  const results: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  // 1. 释放过期 reserved 预占
  const released = releaseExpiredReservations(now);
  if (released > 0) results.push(`释放 ${released} 个过期预占`);

  // 2. 恢复 uncertain + upstream_task_id 非空的操作
  const recoverable = getRecoverableUncertainOperations(50);
  let recovered = 0;
  for (const op of recoverable) {
    try {
      recoverUncertainSubmission(op.operation_id);
      recovered++;
    } catch (e: any) {
      console.error(`[reconcile] 恢复 uncertain 操作 ${op.operation_id} 失败:`, e?.message);
    }
  }
  if (recovered > 0) results.push(`恢复 ${recovered} 个 uncertain 操作`);

  // 3. 列出仍 uncertain 但没有 upstream_task_id 的操作(仅告警,人工处理)
  const allUncertain = getUncertainOperations();
  const manualUncertain = allUncertain.filter((o) => !o.upstream_task_id);
  if (manualUncertain.length > 0) {
    results.push(`⚠ ${manualUncertain.length} 个 uncertain 操作待人工处理(无 upstream_task_id)`);
    console.warn('[reconcile] uncertain 操作(需人工):', manualUncertain.map((o) => o.operation_id).join(', '));
  }

  // 4. 同步 Submitted / Processing 状态任务
  const staleTasks = getStaleVideoTasks(50);
  let synced = 0;
  let settled = 0;
  for (const task of staleTasks) {
    try {
      const result = await syncVideoTask(task.task_id);
      synced++;
      if (result.settled) settled++;
    } catch (e: any) {
      console.error(`[reconcile] 同步任务 ${task.task_id} 失败:`, e?.message);
    }
  }
  results.push(`同步 ${synced} 个任务, ${settled} 个已结算`);

  // 5. 补偿结算: Success + pending attribution 的任务
  const pendingSettlement = getPendingInviteSettlementTasks(50);
  let compensated = 0;
  for (const task of pendingSettlement) {
    try {
      settleInviteReward(task.id);
      compensated++;
    } catch (e) {
      console.error('[invite-reward] settlement failed', e);
    }
  }
  if (compensated > 0) results.push(`补偿结算 ${compensated} 个任务`);

  return NextResponse.json({
    success: true,
    data: {
      at: now,
      summary: results,
      uncertain_count: manualUncertain.length,
      recovered_count: recovered,
    },
  });
}
