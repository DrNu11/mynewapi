import { NextRequest, NextResponse } from 'next/server';
import { finalizeVideoSubmission, getAccountVideoCounts, getCardByCode, getVideoQuotaUsedBySource, markExpiredCards, markReservationUncertain, markSubmissionUncertain, releaseReservation, updateVideoCreateOperation, checkRateLimit } from '@/lib/db';
import {
  createHailuoVideoTask,
  getAccountsTotalQuota,
  HAILUO_ACCOUNTS,
  isHailuoDuration,
  isHailuoModel,
  isHailuoResolution,
} from '@/lib/minimax-video';
import { reserveVideoCapacity, type ReservationResult, QuotaError } from '@/lib/video-quota';
import { isRateLimitError, isNetworkError } from '@/lib/video-errors';
import { createHash } from 'crypto';
import { getVisitByTokenHash, insertAttribution, getInviteLinkById } from '@/lib/invite-reward';
import { hashToken } from '@/lib/risk-hash';
import { clientIp } from '@/lib/client-ip';

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

function payloadHash(args: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 16);
}


export async function POST(req: NextRequest) {
  let body: {
    operation_id?: string;
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

  const operationId = (body.operation_id || '').trim();
  const code = (body.code || '').trim().toUpperCase();
  const prompt = (body.prompt || '').trim();
  const firstFrameImage = (body.first_frame_image || '').trim();
  const model = body.model || 'hailuo-2.3';
  const duration = Number(body.duration || 6);
  const resolution = body.resolution || '1080P';

  if (!operationId) return deny('缺少 operation_id');
  if (!code || code.length < 8 || code.length > 32) return deny('请输入有效的卡密');

  // 限流: 每 IP 每分钟 ≤ 5, 每卡每分钟 ≤ 3
  const ip = clientIp(req);
  if (!checkRateLimit(`video-create:ip:${ip}`, 5, 60)) {
    return deny('请求太频繁,请稍后再试', 429);
  }
  if (!checkRateLimit(`video-create:card:${code}`, 3, 60)) {
    return deny('请求太频繁,请稍后再试', 429);
  }
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

  const hash = payloadHash({ code, prompt, firstFrameImage, model, duration, resolution });

  // Phase 1: 首次预占
  let reservation: ReservationResult;
  try {
    reservation = reserveVideoCapacity({ operationId, cardId: card.id, payloadHash: hash });
  } catch (e: any) {
    if (e instanceof QuotaError) {
      if (e.code === 'DUPLICATE_OPERATION') {
        return NextResponse.json(
          { success: false, message: e.message, code: e.code, data: { operation_id: operationId } },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: false, message: e.message, code: e.code }, { status: e.httpStatus });
    }
    return deny(e?.message || '预占失败', 500);
  }

  // Phase 2: 循环调用 MiniMax — 覆盖 reserve + create, 最多尝试账号数量次
  let created: { taskId: string; accountIndex: number } | null = null;

  for (let attempt = 0; attempt < HAILUO_ACCOUNTS.length; attempt++) {
    try {
      created = await createHailuoVideoTask({
        model: model as any,
        prompt,
        firstFrameImage,
        duration: duration as any,
        resolution: resolution as any,
        accountIndex: reservation.accountIndex,
      });
      break; // 成功,退出循环
    } catch (e: any) {
      const msg = e?.message || String(e);

      // 网络超时/中断 → uncertain,立即返回
      if (isNetworkError(e)) {
        markReservationUncertain(reservation.attemptId);
        updateVideoCreateOperation(operationId, { status: 'uncertain', last_error: msg });
        return NextResponse.json(
          {
            success: false,
            code: 'SUBMISSION_UNCERTAIN',
            message: '提交结果正在确认，请勿重复提交。若长时间未恢复，请联系管理员处理。',
            data: { operation_id: operationId },
          },
          { status: 202 },
        );
      }

      if (isRateLimitError(e)) {
        // 释放当前 attempt,尝试下一个账号
        releaseReservation(reservation.attemptId, 'rate_limited');
        updateVideoCreateOperation(operationId, { status: 'pending', last_error: `限流: ${msg}` });

        // 预占下一个未尝试账号 (reserveVideoCapacity 自动排除已尝试账号)
        try {
          reservation = reserveVideoCapacity({ operationId, cardId: card.id, payloadHash: hash });
        } catch (re: any) {
          if (re instanceof QuotaError && re.code === 'DUPLICATE_OPERATION') break;
          // 无更多可用账号
          updateVideoCreateOperation(operationId, { status: 'failed', last_error: '所有账号均限流或配额不足' });
          return deny('所有海螺账号均不可用,请稍后重试', 429);
        }
        continue; // 用新账号重试
      }

      // 明确失败,释放预占
      releaseReservation(reservation.attemptId, `upstream_error: ${msg}`);
      updateVideoCreateOperation(operationId, { status: 'failed', last_error: msg });
      return deny(msg, 502);
    }
  }

  if (!created) {
    updateVideoCreateOperation(operationId, { status: 'failed', last_error: '所有账号均限流或配额不足' });
    return deny('所有海螺账号均不可用,请稍后重试', 429);
  }

  // Phase 3: 明确成功 → 原子落库
  let task: Awaited<ReturnType<typeof finalizeVideoSubmission>>;
  try {
    task = finalizeVideoSubmission({
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
      quota_source: reservation.quotaSource,
      reservation_id: reservation.reservationId,
      operation_id: operationId,
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: null,
    }, reservation.reservationId);
  } catch (e: any) {
    // MiniMax 已返回 task_id 但本地 DB 落库失败 → 原子保存恢复信息
    markSubmissionUncertain(operationId, reservation.attemptId, {
      upstream_task_id: created.taskId,
      upstream_account_index: created.accountIndex,
      reservation_id: reservation.reservationId,
      recovery_payload_json: JSON.stringify({
        model,
        prompt,
        duration,
        resolution,
        quota_source: reservation.quotaSource,
      }),
    });
    return NextResponse.json(
      {
        success: false,
        code: 'SUBMISSION_UNCERTAIN',
        message: '提交结果正在确认，请勿重复提交。若长时间未恢复，请联系管理员处理。',
        data: { operation_id: operationId },
      },
      { status: 202 },
    );
  }

  // 尝试写邀请归因(失败不阻断视频生成)
  try {
    const visitToken = req.cookies.get('invite_visit')?.value;
    if (visitToken) {
      const tokenHash = hashToken(visitToken);
      const visit = getVisitByTokenHash(tokenHash);
      if (visit) {
        const inviteLink = getInviteLinkById(visit.invite_link_id);
        if (inviteLink && inviteLink.inviter_card_id !== card.id) {
          insertAttribution({
            invite_visit_id: visit.id,
            invite_link_id: inviteLink.id,
            inviter_card_id: inviteLink.inviter_card_id,
            invitee_card_id: card.id,
            video_task_id: task.id,
          });
        }
      }
    }
  } catch (e) {
    console.error('[invite] attribution insert failed', e);
  }

  const baseUsed = getVideoQuotaUsedBySource(card.id, 'base');
  const bonusUsed = getVideoQuotaUsedBySource(card.id, 'invite_bonus');
  const counts = getAccountVideoCounts();
  const totalQuota = getAccountsTotalQuota();
  const globalUsed = counts ? Object.values(counts).reduce((s, c) => s + c, 0) : 0;

  return NextResponse.json({
    success: true,
    data: {
      operation_id: operationId,
      task_id: task.task_id,
      status: task.status,
      created_at: task.created_at,
      account_index: created.accountIndex,
      quota_source: reservation.quotaSource,
      base: {
        total: card.video_quota,
        used: baseUsed,
        remaining: Math.max(0, card.video_quota - baseUsed),
      },
      invite_bonus: {
        total: card.video_bonus_quota,
        used: bonusUsed,
        remaining: Math.max(0, card.video_bonus_quota - bonusUsed),
      },
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
}
