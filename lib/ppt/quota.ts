import type { Card } from '@/lib/db';
import { getPptQuotaUsed } from '@/lib/db';

export interface PptQuotaSnapshot {
  total: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

export class PptAccessError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function assertActivePptCard(card: Card): void {
  if (card.status === 'disabled') {
    throw new PptAccessError(card.disable_reason || '此 API Key 已被禁用', 403);
  }
  if (card.status === 'expired' || (card.expires_at && card.expires_at <= Math.floor(Date.now() / 1000))) {
    throw new PptAccessError('此 API Key 已过期', 403);
  }
  if (card.status !== 'activated') {
    throw new PptAccessError('请先激活卡密后再生成 PPT', 403);
  }
}

export function getPptQuotaSnapshot(card: Card): PptQuotaSnapshot {
  const used = getPptQuotaUsed(card.id);
  const total = card.ppt_quota;
  if (total === null || total === undefined) {
    return { total: null, used, remaining: null, unlimited: true };
  }
  return {
    total,
    used,
    remaining: Math.max(0, total - used),
    unlimited: false,
  };
}

export function assertPptQuotaAvailable(card: Card): PptQuotaSnapshot {
  const quota = getPptQuotaSnapshot(card);
  if (!quota.unlimited && (quota.remaining ?? 0) <= 0) {
    throw new PptAccessError('PPT 生成次数已用完,请购买或续费 PPT 套餐', 402);
  }
  return quota;
}

