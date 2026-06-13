import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, getVideoCreateOperation, getVideoTaskByOperationId } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let body: { code?: string; operation_id?: string };
  try {
    body = await req.json();
  } catch {
    return deny('请求格式错误');
  }

  const code = (body.code || '').trim().toUpperCase();
  const opId = (body.operation_id || '').trim();

  if (!code || code.length < 8 || code.length > 32) return deny('请输入有效的卡密');
  if (!opId) return deny('缺少 operation_id');

  const card = getCardByCode(code);
  if (!card) return deny('未找到该卡密', 404);

  const op = getVideoCreateOperation(opId);
  if (!op) return deny('未找到该操作记录', 404);
  if (op.card_id !== card.id) return deny('无权查看该操作', 403);

  const task = op.video_task_id ? getVideoTaskByOperationId(opId) : null;

  return NextResponse.json({
    success: true,
    data: {
      operation_id: op.operation_id,
      status: op.status,
      last_error: op.last_error,
      task_id: task?.task_id || null,
      video_status: task?.status || null,
      download_url: task?.download_url || null,
    },
  });
}
