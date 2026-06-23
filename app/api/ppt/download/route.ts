import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getCardByTokenKey, getPptTaskByTaskId } from '@/lib/db';
import { apiKeyFromRequest, validateSkKey } from '@/lib/ppt/api';
import { PPT_TASKS_DIR } from '@/lib/ppt/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function safeFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${cleaned || 'nassa-ppt'}.pptx`;
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
  if (task.card_id !== card.id) return deny('无权下载该 PPT', 403);
  if (task.status !== 'success' || !task.pptx_path) return deny('PPT 尚未生成完成', 409);

  const resolvedRoot = path.resolve(PPT_TASKS_DIR);
  const resolvedFile = path.resolve(task.pptx_path);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    return deny('文件路径异常', 500);
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(resolvedFile);
  } catch {
    return deny('PPT 文件不存在或已被清理', 404);
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName(task.title))}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
