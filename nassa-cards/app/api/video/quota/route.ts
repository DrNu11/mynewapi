import { NextRequest, NextResponse } from 'next/server';
import { getAccountVideoCounts, getCardByCode, getVideoQuotaUsedBySource, countReservedBySource, markExpiredCards, todayStartSeconds } from '@/lib/db';
import { getAccountsTotalQuota, HAILUO_ACCOUNTS } from '@/lib/minimax-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildGlobalQuota() {
  const counts = getAccountVideoCounts();
  const totalQuota = getAccountsTotalQuota();
  const totalUsed = counts ? Object.values(counts).reduce((s, c) => s + c, 0) : 0;
  return {
    global_quota_total: totalQuota,
    global_quota_used: totalUsed,
    global_quota_remaining: Math.max(0, totalQuota - totalUsed),
    accounts: HAILUO_ACCOUNTS.map((a) => ({
      index: a.index,
      quota: a.quota,
      used: counts[a.index] || 0,
      remaining: Math.max(0, a.quota - (counts[a.index] || 0)),
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

  const baseAvailable = card.status === 'unused' ? Math.max(0, card.video_quota - baseUsed - baseReserved) : 0;
  const bonusAvailable = (card.status === 'unused' || card.status === 'activated')
    ? Math.max(0, card.video_bonus_quota - bonusUsed - bonusReserved)
    : 0;

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
