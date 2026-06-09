import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, getVideoTaskByTaskId, updateVideoTask } from '@/lib/db';
import { queryMiniMaxVideoTask, retrieveMiniMaxFile } from '@/lib/minimax-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function isTerminal(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes('success') ||
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('cancel')
  );
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

  if (task.download_url || isTerminal(task.status)) {
    return NextResponse.json({ success: true, data: task });
  }

  try {
    const remote = await queryMiniMaxVideoTask(taskId);
    let patch = {
      status: remote.status,
      file_id: remote.fileId,
      download_url: null as string | null,
      error_message: null as string | null,
    };

    if (remote.fileId && remote.status.toLowerCase().includes('success')) {
      const file = await retrieveMiniMaxFile(remote.fileId);
      patch = { ...patch, download_url: file.downloadUrl };
    }

    const updated = updateVideoTask(taskId, patch);
    return NextResponse.json({ success: true, data: updated });
  } catch (e: any) {
    const updated = updateVideoTask(taskId, {
      status: 'QueryFailed',
      error_message: e?.message || '查询视频任务失败',
    });
    return NextResponse.json({ success: false, message: updated?.error_message, data: updated }, { status: 502 });
  }
}
