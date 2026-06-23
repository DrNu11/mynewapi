import { NextRequest, NextResponse } from 'next/server';
import { getCardByTokenKey, getPptTaskByTaskId } from '@/lib/db';
import { apiKeyFromRequest, validateSkKey } from '@/lib/ppt/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function GET(req: NextRequest) {
  const taskId = (req.nextUrl.searchParams.get('taskId') || '').trim();
  if (!taskId) return deny('缺少 taskId');

  const apiKey = apiKeyFromRequest(req);
  const keyError = validateSkKey(apiKey);
  if (keyError) return deny(keyError);

  const card = getCardByTokenKey(apiKey);
  if (!card) return deny('未找到该 API Key', 404);

  const task = getPptTaskByTaskId(taskId);
  if (!task) return deny('未找到该 PPT 任务', 404);
  if (task.card_id !== card.id) return deny('无权查看该 PPT 任务', 403);

  return NextResponse.json({
    success: true,
    data: {
      taskId: task.task_id,
      status: task.status,
      title: task.title,
      scenario: task.scenario,
      style: task.style,
      slideCount: task.slide_count,
      templateId: task.template_id,
      errorMessage: task.error_message,
      downloadUrl: task.status === 'success' ? `/api/ppt/download?taskId=${encodeURIComponent(task.task_id)}` : null,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    },
  });
}

