import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, getVideoTaskByTaskId } from '@/lib/db';
import { syncVideoTask } from '@/lib/video-sync';

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

  const card = getCardByCode(code);
  if (!card) return deny('未找到该卡密', 404);

  const task = getVideoTaskByTaskId(taskId);
  if (!task) return deny('未找到该视频任务', 404);
  if (task.card_id !== card.id) {
    return deny('无权查看该视频任务', 403);
  }

  // 已经是终态且有下载地址,直接返回
  if (task.download_url && task.status === 'Success') {
    return NextResponse.json({ success: true, data: task });
  }

  const { task: updated, settled } = await syncVideoTask(taskId);
  return NextResponse.json({ success: true, data: updated });
}
