import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode } from '@/lib/db';
import { getInviteLinkByCardId, getInviteLinkStats } from '@/lib/invite-reward';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { card_code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = (body.card_code || '').trim().toUpperCase();
  if (!code || code.length < 8 || code.length > 32) {
    return NextResponse.json({ success: false, message: '请输入有效的卡密' }, { status: 400 });
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '未找到该卡密' }, { status: 404 });
  }

  const link = getInviteLinkByCardId(card.id);
  if (!link) {
    return NextResponse.json({
      success: true,
      data: {
        has_link: false,
        today_rewards: 0,
        today_remaining: 3,
        total_rewards: 0,
        pending_review: 0,
        successful_invites: 0,
        daily_cap_rejected: 0,
      },
    });
  }

  const stats = getInviteLinkStats(card.id);
  return NextResponse.json({
    success: true,
    data: {
      has_link: true,
      ...stats,
    },
  });
}
