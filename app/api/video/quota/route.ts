import { NextRequest, NextResponse } from 'next/server';
import { getAccountVideoCounts, getCardByCode, getRecentVideoCount, getVideoQuotaUsed, markExpiredCards } from '@/lib/db';
import { getAccountsTotalQuota, HAILUO_ACCOUNTS } from '@/lib/minimax-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIDEO_QUOTA_PER_CARD = 1;

function buildGlobalQuota() {
  const counts = getAccountVideoCounts();
  const totalQuota = getAccountsTotalQuota();
  const totalUsed = getRecentVideoCount();
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
  if (card.status !== 'unused') {
    return NextResponse.json({ success: false, message: '仅限未激活卡密使用视频生成' }, { status: 403 });
  }

  const used = getVideoQuotaUsed(card.id);
  const remaining = Math.max(0, VIDEO_QUOTA_PER_CARD - used);

  return NextResponse.json({
    success: true,
    data: {
      quota_total: VIDEO_QUOTA_PER_CARD,
      quota_used: used,
      quota_remaining: remaining,
      ...buildGlobalQuota(),
    },
  });
}
