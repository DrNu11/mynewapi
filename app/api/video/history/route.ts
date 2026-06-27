import { NextRequest, NextResponse } from 'next/server';

import { checkRateLimit, getCardByCode, listVideoTasksByCardId } from '@/lib/db';
import { clientIp } from '@/lib/client-ip';
import { toPublicVideoTask } from '@/lib/video-public';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') || '').trim().toUpperCase();
  if (!code || code.length < 8 || code.length > 32) {
    return NextResponse.json({ success: false, message: '请输入有效的卡密' }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!checkRateLimit(`video-history:ip:${ip}`, 30, 60)) {
    return NextResponse.json({ success: false, message: '请求太频繁,请稍后再试' }, { status: 429 });
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '未找到该卡密' }, { status: 404 });
  }

  const tasks = listVideoTasksByCardId(card.id, 50).map(toPublicVideoTask);
  return NextResponse.json({ success: true, data: { tasks } });
}
