/**
 * 视频额度预占 — IMMEDIATE 事务内完成额度判断、来源选择和账号选择。
 * 不在此事务中发起网络请求。
 */
import {
  getAccountsTotalQuota,
  HAILUO_ACCOUNTS,
} from '@/lib/minimax-video';
import {
  countAccountUsageToday,
  countReservedBySource,
  getCardForUpdate,
  getVideoCreateOperation,
  getVideoQuotaUsedBySource,
  insertReservation,
  insertVideoCreateOperation,
  releaseExpiredReservations,
  markExpiredCards,
  todayStartSeconds,
} from '@/lib/db';
import type { Card } from '@/lib/db';

const RESERVATION_TTL_SEC = 120;

export interface ReservationResult {
  operationId: string;
  attemptId: string;
  reservationId: number;
  quotaSource: string;
  accountIndex: number;
  card: Card;
}

export class QuotaError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus: number,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

function chooseQuotaSource(card: Card, now: number): string | null {
  if (card.status === 'unused') {
    const baseUsed = getVideoQuotaUsedBySource(card.id, 'base');
    const baseReserved = countReservedBySource(card.id, 'base', now);
    if (baseUsed + baseReserved < card.video_quota) return 'base';
  }
  // bonus 在 unused 和 activated 状态下都可用
  if (card.status === 'unused' || card.status === 'activated') {
    const bonusUsed = getVideoQuotaUsedBySource(card.id, 'invite_bonus');
    const bonusReserved = countReservedBySource(card.id, 'invite_bonus', now);
    if (bonusUsed + bonusReserved < card.video_bonus_quota) return 'invite_bonus';
  }
  return null;
}

export function reserveVideoCapacity(args: {
  operationId: string;
  cardId: number;
  payloadHash: string;
  excludedAccountIndexes?: number[];
}): ReservationResult {
  const now = Math.floor(Date.now() / 1000);
  releaseExpiredReservations(now);
  markExpiredCards();

  const card = getCardForUpdate(args.cardId);
  if (!card) throw new QuotaError('未找到该卡密', 'CARD_NOT_FOUND', 404);

  if (card.status === 'disabled') {
    throw new QuotaError(card.disable_reason || '此卡密已被禁用', 'CARD_DISABLED', 403);
  }
  if (card.status === 'expired') {
    throw new QuotaError('此卡密已过期', 'CARD_EXPIRED', 410);
  }
  if (card.status === 'activating') {
    throw new QuotaError('卡密激活中,请稍后重试', 'CARD_ACTIVATING', 409);
  }
  if (card.status !== 'unused' && card.status !== 'activated') {
    throw new QuotaError('卡密状态不支持视频生成', 'CARD_STATUS', 403);
  }

  // 检查已有 operation
  const existing = getVideoCreateOperation(args.operationId);
  if (existing) {
    if (existing.payload_hash !== args.payloadHash) {
      throw new QuotaError('幂等键冲突:请勿复用 operation_id', 'IDEMPOTENT_CONFLICT', 409);
    }
    // 已有相同 operation: 返回已有状态
    throw new QuotaError('请求已提交,请勿重复操作', 'DUPLICATE_OPERATION', 409);
  }

  const quotaSource = chooseQuotaSource(card, now);
  if (!quotaSource) {
    throw new QuotaError('该卡密视频生成次数已用完', 'CARD_QUOTA_EXHAUSTED', 429);
  }

  const since = todayStartSeconds();
  const excludedIndexes = args.excludedAccountIndexes ?? [];
  let accountIndex: number | null = null;

  for (const acc of HAILUO_ACCOUNTS) {
    if (excludedIndexes.includes(acc.index)) continue;
    const used = countAccountUsageToday(acc.index, since, now);
    if (used < acc.quota) {
      accountIndex = acc.index;
      break;
    }
  }

  if (accountIndex === null) {
    const totalQuota = getAccountsTotalQuota();
    throw new QuotaError(
      `今日全局视频生成额度已用完 (${totalQuota}/${totalQuota})，0 点自动重置`,
      'GLOBAL_QUOTA_EXHAUSTED',
      429,
    );
  }

  // 写 operation
  insertVideoCreateOperation({
    operation_id: args.operationId,
    card_id: card.id,
    payload_hash: args.payloadHash,
  });

  // 写 reservation
  const attemptId = crypto.randomUUID();
  const reservationId = insertReservation({
    operation_id: args.operationId,
    attempt_id: attemptId,
    card_id: card.id,
    quota_source: quotaSource,
    account_index: accountIndex,
    status: 'reserved',
    expires_at: now + RESERVATION_TTL_SEC,
  });

  return {
    operationId: args.operationId,
    attemptId,
    reservationId,
    quotaSource,
    accountIndex,
    card,
  };
}
