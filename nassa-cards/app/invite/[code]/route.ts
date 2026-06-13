import { NextRequest, NextResponse } from 'next/server';
import { getInviteLinkByCode, createVisit } from '@/lib/invite-reward';
import { hashToken, generateToken } from '@/lib/risk-hash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const inviteCode = params.code;

  const link = getInviteLinkByCode(inviteCode);
  if (!link || link.status !== 'active') {
    // 链接无效,仍然跳转 /video,但不设置归因
    return NextResponse.redirect(new URL('/video', req.url));
  }

  // 首次有效归因优先: 检查是否已有未过期 visit cookie
  const existingCookie = req.cookies.get('invite_visit');
  if (existingCookie?.value) {
    // 已有归因,不覆盖
    return NextResponse.redirect(new URL('/video', req.url));
  }

  // 创建新 visit
  const token = generateToken();
  const tokenHash = hashToken(token);

  // 检查或创建 device_id cookie
  let deviceToken = req.cookies.get('device_id')?.value;
  if (!deviceToken) {
    deviceToken = generateToken();
  }
  const deviceHash = hashToken(deviceToken);

  createVisit(link.id, tokenHash, null, deviceHash);

  const redirect = NextResponse.redirect(new URL('/video', req.url));
  redirect.cookies.set('invite_visit', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 86400,
    path: '/',
  });
  redirect.cookies.set('device_id', deviceToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 15552000,
    path: '/',
  });

  return redirect;
}
