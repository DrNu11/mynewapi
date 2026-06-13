import { NextRequest, NextResponse } from 'next/server';
import { getStaleVideoTasks, getUncertainOperations, releaseExpiredReservations } from '@/lib/db';
import { syncVideoTask } from '@/lib/video-sync';

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

  // 2. 列出 uncertain 操作(仅告警,不自动处理)
  const uncertain = getUncertainOperations();
  if (uncertain.length > 0) {
    results.push(`⚠ ${uncertain.length} 个 uncertain 操作待人工处理`);
    console.warn('[reconcile] uncertain 操作:', uncertain.map((o) => o.operation_id).join(', '));
  }

  // 3. 同步 Submitted / Processing 状态任务
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

  return NextResponse.json({
    success: true,
    data: {
      at: now,
      summary: results,
      uncertain_count: uncertain.length,
    },
  });
}
