import { NextRequest, NextResponse } from 'next/server';
import { getInviteLinkByCode, createVisit } from '@/lib/invite-reward';
import { checkRateLimit } from '@/lib/db';
import { clientIp } from '@/lib/client-ip';
import { hashIp, hashToken, generateToken } from '@/lib/risk-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const inviteCode = params.code;

  // 限流: 每 IP 每分钟 ≤ 30
  const ip = clientIp(req);
  if (!checkRateLimit(`invite-visit:ip:${ip}`, 30, 60)) {
    return NextResponse.json({ success: false, message: '请求太频繁,请稍后再试' }, { status: 429 });
  }

  const link = getInviteLinkByCode(inviteCode);
  if (!link || link.status !== 'active') {
    return NextResponse.redirect(new URL('/video', req.url));
  }

  // 首次有效归因优先: 检查是否已有未过期 visit cookie
  const existingCookie = req.cookies.get('invite_visit');
  if (existingCookie?.value) {
    return NextResponse.redirect(new URL('/video', req.url));
  }

  // 创建新 visit
  const token = generateToken();
  const tokenHash = hashToken(token);
  const ipHash = hashIp(ip);

  // 检查或创建 device_id cookie
  let deviceToken = req.cookies.get('device_id')?.value;
  if (!deviceToken) {
    deviceToken = generateToken();
  }
  const deviceHash = hashToken(deviceToken);

  createVisit(link.id, tokenHash, ipHash, deviceHash);

  const cookieSecure = process.env.COOKIE_SECURE !== 'false';
  const redirect = NextResponse.redirect(new URL('/video', req.url));
  redirect.cookies.set('invite_visit', token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 86400,
    path: '/',
  });
  redirect.cookies.set('device_id', deviceToken, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    maxAge: 15552000,
    path: '/',
  });

  return redirect;
}
