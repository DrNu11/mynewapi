import { NextRequest, NextResponse } from 'next/server';
import { commitReservation, getAccountVideoCounts, getCardByCode, getVideoCreateOperation, getVideoQuotaUsedBySource, insertVideoTask, markExpiredCards, markReservationUncertain, releaseExpiredReservations, releaseReservation, updateVideoCreateOperation, todayStartSeconds } from '@/lib/db';
import {
  createHailuoVideoTask,
  getAccountsTotalQuota,
  HAILUO_ACCOUNTS,
  isHailuoDuration,
  isHailuoModel,
  isHailuoResolution,
} from '@/lib/minimax-video';
import { reserveVideoCapacity, type ReservationResult, QuotaError } from '@/lib/video-quota';
import { createHash } from 'crypto';
import { getVisitByTokenHash, insertAttribution, getInviteLinkById } from '@/lib/invite-reward';
import { hashToken } from '@/lib/risk-hash';

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

  // Phase 1: 预占
  let reservation: ReservationResult;
  try {
    reservation = reserveVideoCapacity({
      operationId,
      cardId: card.id,
      payloadHash: hash,
    });
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

  // Phase 2: 调用 MiniMax(在事务外)
  let created: { taskId: string; accountIndex: number };
  try {
    created = await createHailuoVideoTask({
      model: model as any,
      prompt,
      firstFrameImage,
      duration: duration as any,
      resolution: resolution as any,
      accountIndex: reservation.accountIndex,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    const isRateLimit =
      e?.httpStatus === 429 ||
      e?.apiStatusCode === 1004 ||
      msg.includes('rate') ||
      msg.includes('Rate') ||
      msg.includes('limit') ||
      msg.includes('quota') ||
      msg.includes('Quota') ||
      msg.includes('exceeded');

    if (isRateLimit) {
      // 释放当前 attempt,切换其他账号重试
      releaseReservation(reservation.attemptId, 'rate_limited');
      updateVideoCreateOperation(operationId, { status: 'pending', last_error: `限流: ${msg}` });

      // 最多尝试账号数量次
      let retryResult: ReservationResult | null = null;
      const triedIndexes = [reservation.accountIndex];
      for (let i = 0; i < HAILUO_ACCOUNTS.length; i++) {
        try {
          retryResult = reserveVideoCapacity({
            operationId,
            cardId: card.id,
            payloadHash: hash,
            excludedAccountIndexes: triedIndexes,
          });
          break;
        } catch (re: any) {
          if (re instanceof QuotaError && re.code === 'DUPLICATE_OPERATION') break;
          // 继续尝试下一个账号
        }
      }

      if (!retryResult) {
        updateVideoCreateOperation(operationId, { status: 'failed', last_error: '所有账号均限流或配额不足' });
        return deny('所有海螺账号均不可用,请稍后重试', 429);
      }

      reservation = retryResult;
      try {
        created = await createHailuoVideoTask({
          model: model as any,
          prompt,
          firstFrameImage,
          duration: duration as any,
          resolution: resolution as any,
          accountIndex: reservation.accountIndex,
        });
      } catch (e2: any) {
        releaseReservation(reservation.attemptId, 'retry_failed');
        updateVideoCreateOperation(operationId, { status: 'failed', last_error: `重试失败: ${e2?.message || e2}` });
        return deny(e2?.message || '创建视频任务失败', 502);
      }
    } else if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('abort')) {
      // 网络超时 → uncertain
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
    } else {
      // 明确失败,释放预占
      releaseReservation(reservation.attemptId, `upstream_error: ${msg}`);
      updateVideoCreateOperation(operationId, { status: 'failed', last_error: msg });
      return deny(msg, 502);
    }
  }

  // Phase 3: 明确成功 → 落库 + commit
  const taskRow = {
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
  };

  const task = insertVideoTask(taskRow);
  commitReservation(reservation.reservationId);
  updateVideoCreateOperation(operationId, { status: 'submitted', video_task_id: task.id });

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
  } catch {}

  const now = Math.floor(Date.now() / 1000);
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
