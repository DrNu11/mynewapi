import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, getVideoTaskByTaskId, checkRateLimit } from '@/lib/db';
import { syncVideoTask } from '@/lib/video-sync';
import { clientIp } from '@/lib/client-ip';
import { toPublicVideoTask } from '@/lib/video-public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let body: { code?: string; task_id?: string };
  try {
    body = await req.json();
  } catch {
    return deny('请求格式错误');
  }

  const code = (body.code || '').trim().toUpperCase();
  const taskId = (body.task_id || '').trim();
  if (!code || code.length < 8 || code.length > 32) return deny('请输入有效的卡密');
  if (!taskId) return deny('缺少 task_id');

  // 限流: 每 IP 每分钟 ≤ 60
  const ip = clientIp(req);
  if (!checkRateLimit(`video-status:ip:${ip}`, 60, 60)) {
    return deny('请求太频繁,请稍后再试', 429);
  }

  const card = getCardByCode(code);
  if (!card) return deny('未找到该卡密', 404);

  const task = getVideoTaskByTaskId(taskId);
  if (!task) return deny('未找到该视频任务', 404);
  if (task.card_id !== card.id) {
    return deny('无权查看该视频任务', 403);
  }

  // 调用 syncVideoTask 进行状态同步和奖励结算(对终态幂等)
  const { task: updated } = await syncVideoTask(taskId);
  return NextResponse.json({ success: true, data: toPublicVideoTask(updated) });
}
