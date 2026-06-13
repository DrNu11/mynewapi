import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode, markExpiredCards } from '@/lib/db';
import { createInviteLink, getInviteLinkByCardId, getInviteLinkStats } from '@/lib/invite-reward';

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
  if (card.status !== 'unused' && card.status !== 'activated') {
    return NextResponse.json({ success: false, message: '卡密状态不支持邀请' }, { status: 403 });
  }
  // activated 卡检查是否已过期
  if (card.status === 'activated' && card.expires_at && card.expires_at <= Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ success: false, message: '此卡密已过期' }, { status: 410 });
  }

  // 复用已有链接或创建新链接
  let link = getInviteLinkByCardId(card.id);
  if (!link) {
    link = createInviteLink(card.id, null, null);
  }

  const stats = getInviteLinkStats(card.id);
  const baseUrl = process.env.PUBLIC_API_BASE_ROOT || 'https://card.nassaapi.xyz';

  return NextResponse.json({
    success: true,
    data: {
      invite_url: `${baseUrl}/invite/${link.invite_code}`,
      ...stats,
    },
  });
}
