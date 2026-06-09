import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, insertVideoTask, markExpiredCards } from '@/lib/db';
import {
  createMiniMaxVideoTask,
  isMiniMaxVideoDuration,
  isMiniMaxVideoModel,
  isMiniMaxVideoResolution,
} from '@/lib/minimax-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROMPT_LEN = 1800;
const MAX_IMAGE_LEN = 12 * 1024 * 1024;

function validImageRef(v: string): boolean {
  return /^https?:\/\//i.test(v) || /^data:image\/(png|jpe?g|webp);base64,/i.test(v);
}

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function POST(req: NextRequest) {
  let body: {
    code?: string;
    prompt?: string;
    first_frame_image?: string;
    model?: string;
    duration?: number;
    resolution?: string;
  };
  try {
    body = await req.json();
  } catch {
    return deny('请求格式错误');
  }

  const code = (body.code || '').trim().toUpperCase();
  const prompt = (body.prompt || '').trim();
  const firstFrameImage = (body.first_frame_image || '').trim();
  const model = body.model || 'MiniMax-Hailuo-2.3';
  const duration = Number(body.duration || 6);
  const resolution = body.resolution || '1080P';

  if (!code || code.length < 8 || code.length > 32) return deny('请输入有效的卡密');
  if (!prompt || prompt.length > MAX_PROMPT_LEN) return deny(`提示词长度需为 1-${MAX_PROMPT_LEN} 字符`);
  if (!firstFrameImage || firstFrameImage.length > MAX_IMAGE_LEN || !validImageRef(firstFrameImage)) {
    return deny('首帧图片需为 http(s) 图片 URL 或 PNG/JPEG/WebP Data URL');
  }
  if (!isMiniMaxVideoModel(model)) return deny('不支持的视频模型');
  if (!isMiniMaxVideoDuration(duration)) return deny('不支持的视频时长');
  if (!isMiniMaxVideoResolution(resolution)) return deny('不支持的分辨率');

  markExpiredCards();
  const card = getCardByCode(code);
  if (!card) return deny('未找到该卡密', 404);
  if (card.category !== 'gpt' && card.category !== 'deepseek') {
    return deny('视频生成功能仅支持 GPT / DeepSeek 卡密', 403);
  }
  if (card.status === 'disabled') return deny(card.disable_reason || '此卡密已被禁用', 403);
  if (card.status !== 'activated' || !card.newapi_token_key) {
    return deny('请先激活卡密后再生成视频', 403);
  }
  if (card.expires_at && card.expires_at <= Math.floor(Date.now() / 1000)) {
    return deny('此卡密已过期', 403);
  }

  try {
    const created = await createMiniMaxVideoTask({
      model,
      prompt,
      firstFrameImage,
      duration,
      resolution,
    });
    const task = insertVideoTask({
      task_id: created.taskId,
      card_id: card.id,
      sk_key: card.newapi_token_key,
      model,
      prompt,
      duration,
      resolution,
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
    });

    return NextResponse.json({
      success: true,
      data: {
        task_id: task.task_id,
        status: task.status,
        created_at: task.created_at,
      },
    });
  } catch (e: any) {
    return deny(e?.message || '创建视频任务失败', 502);
  }
}
