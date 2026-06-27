import { NextRequest, NextResponse } from 'next/server';
import { getAccountVideoCounts, getCardByCode, getVideoQuotaUsedBySource, countReservedBySource, markExpiredCards } from '@/lib/db';
import {
  getVideoProviderTargets,
  getVideoProviderTotalQuota,
  isNewApiVideoConfigured,
} from '@/lib/video-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildGlobalQuota() {
  const counts = getAccountVideoCounts();
  const totalQuota = getVideoProviderTotalQuota();
  const totalUsed = counts ? Object.values(counts).reduce((s, c) => s + c, 0) : 0;
  const targets = getVideoProviderTargets();
  return {
    provider: isNewApiVideoConfigured() ? 'newapi' : 'minimax_direct',
    global_quota_total: totalQuota,
    global_quota_used: totalUsed,
    global_quota_remaining: totalQuota === null ? null : Math.max(0, totalQuota - totalUsed),
    accounts: targets.map((a) => ({
      index: a.index,
      quota: totalQuota === null ? null : a.quota,
      used: counts[a.index] || 0,
      remaining: totalQuota === null ? null : Math.max(0, a.quota - (counts[a.index] || 0)),
    })),
  };
}

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') || '').trim().toUpperCase();

  if (!code) {
    return NextResponse.json({
      success: true,
      data: buildGlobalQuota(),
    });
  }

  if (code.length < 8 || code.length > 32) {
    return NextResponse.json({ success: false, message: '请输入有效的卡密' }, { status: 400 });
  }

  markExpiredCards();
  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '未找到该卡密' }, { status: 404 });
  }
  if (card.status === 'disabled') {
    return NextResponse.json({ success: false, message: card.disable_reason || '此卡密已被禁用' }, { status: 403 });
  }
  if (card.status === 'expired') {
    return NextResponse.json({ success: false, message: '此卡密已过期' }, { status: 410 });
  }
  if (card.status === 'activating') {
    return NextResponse.json({ success: false, message: '卡密激活中,请稍后重试' }, { status: 409 });
  }
  // 支持 unused 和 activated 卡
  if (card.status !== 'unused' && card.status !== 'activated') {
    return NextResponse.json({ success: false, message: '卡密状态不支持视频生成' }, { status: 403 });
  }

  const now = Math.floor(Date.now() / 1000);
  const baseUsed = getVideoQuotaUsedBySource(card.id, 'base');
  const bonusUsed = getVideoQuotaUsedBySource(card.id, 'invite_bonus');
  const baseReserved = countReservedBySource(card.id, 'base', now);
  const bonusReserved = countReservedBySource(card.id, 'invite_bonus', now);

  const canUseVideoQuota = card.status === 'unused' || card.status === 'activated';
  const baseAvailable = canUseVideoQuota ? Math.max(0, card.video_quota - baseUsed - baseReserved) : 0;
  const bonusAvailable = canUseVideoQuota ? Math.max(0, card.video_bonus_quota - bonusUsed - bonusReserved) : 0;

  return NextResponse.json({
    success: true,
    data: {
      base: {
        total: card.video_quota,
        used: baseUsed,
        reserved: baseReserved,
        remaining: baseAvailable,
      },
      invite_bonus: {
        total: card.video_bonus_quota,
        used: bonusUsed,
        reserved: bonusReserved,
        remaining: bonusAvailable,
      },
      ...buildGlobalQuota(),
    },
  });
}
