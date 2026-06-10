import { NextRequest, NextResponse } from 'next/server';
import { getAccountVideoCounts, getCardByCode, getRecentVideoCount, getVideoQuotaUsed, insertVideoTask, markExpiredCards, todayStartSeconds } from '@/lib/db';
import {
  createHailuoVideoTask,
  getAccountsTotalQuota,
  HAILUO_ACCOUNTS,
  isHailuoDuration,
  isHailuoModel,
  isHailuoResolution,
} from '@/lib/minimax-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PROMPT_LEN = 1800;
const MAX_IMAGE_LEN = 12 * 1024 * 1024;
const VIDEO_QUOTA_PER_CARD = 1;

function validImageRef(v: string): boolean {
  return /^https?:\/\//i.test(v) || /^data:image\/(png|jpe?g|webp);base64,/i.test(v);
}

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

function findAvailableAccounts(): number[] {
  const counts = getAccountVideoCounts();
  return HAILUO_ACCOUNTS
    .filter((a) => (counts[a.index] || 0) < a.quota)
    .map((a) => a.index);
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
  const model = body.model || 'hailuo-2.3';
  const duration = Number(body.duration || 6);
  const resolution = body.resolution || '1080P';

  if (!code || code.length < 8 || code.length > 32) return deny('请输入有效的卡密');
  if (!prompt || prompt.length > MAX_PROMPT_LEN) return deny(`提示词长度需为 1-${MAX_PROMPT_LEN} 字符`);
  if (!firstFrameImage || firstFrameImage.length > MAX_IMAGE_LEN || !validImageRef(firstFrameImage)) {
    return deny('首帧图片需为 http(s) 图片 URL 或 PNG/JPEG/WebP Data URL');
  }
  if (!isHailuoModel(model)) return deny('不支持的视频模型');
  if (!isHailuoDuration(duration)) return deny('不支持的视频时长');
  if (!isHailuoResolution(resolution)) return deny('不支持的分辨率');

  markExpiredCards();
  const card = getCardByCode(code);
  if (!card) return deny('未找到该卡密', 404);
  if (card.status === 'disabled') return deny(card.disable_reason || '此卡密已被禁用', 403);
  if (card.status === 'expired') return deny('此卡密已过期', 410);
  if (card.status !== 'unused') return deny('仅限未激活卡密使用视频生成，已激活卡密可直接用于 API 调用和续费', 403);

  // 每张卡只能生成 1 个视频
  const used = getVideoQuotaUsed(card.id);
  if (used >= VIDEO_QUOTA_PER_CARD) {
    return deny('该卡密视频生成次数已用完 (1/1)', 429);
  }

  // 找到有剩余配额的账号
  const availableAccounts = findAvailableAccounts();
  if (availableAccounts.length === 0) {
    const totalQuota = getAccountsTotalQuota();
    const nextReset = todayStartSeconds() + 86400;
    return deny(`今日全局视频生成额度已用完 (${totalQuota}/${totalQuota})，0 点自动重置`, 429);
  }

  try {
    const created = await createHailuoVideoTask({
      model,
      prompt,
      firstFrameImage,
      duration,
      resolution,
    });
    const task = insertVideoTask({
      task_id: created.taskId,
      card_id: card.id,
      sk_key: card.newapi_token_key || code,
      model,
      prompt,
      duration,
      resolution,
      status: 'Submitted',
      file_id: null,
      download_url: null,
      error_message: null,
      account_index: created.accountIndex,
    });

    const counts = getAccountVideoCounts();
    const globalUsed = getRecentVideoCount();
    const totalQuota = getAccountsTotalQuota();

    return NextResponse.json({
      success: true,
      data: {
        task_id: task.task_id,
        status: task.status,
        created_at: task.created_at,
        account_index: created.accountIndex,
        quota_total: VIDEO_QUOTA_PER_CARD,
        quota_used: used + 1,
        quota_remaining: 0,
        global_quota_total: totalQuota,
        global_quota_used: globalUsed,
        global_quota_remaining: Math.max(0, totalQuota - globalUsed),
        accounts: HAILUO_ACCOUNTS.map((a) => ({
          index: a.index,
          quota: a.quota,
          used: counts[a.index] || 0,
          remaining: Math.max(0, a.quota - (counts[a.index] || 0)),
        })),
      },
    });
  } catch (e: any) {
    return deny(e?.message || '创建视频任务失败', 502);
  }
}
