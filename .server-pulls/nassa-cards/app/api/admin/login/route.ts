import { NextRequest, NextResponse } from 'next/server';
import { checkAdminCredentials, createAdminSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(`admin-login:${ip}`, 5, 60)) {
    return NextResponse.json({ success: false, message: '尝试过多,请稍后' }, { status: 429 });
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }
  const { username = '', password = '' } = body;

  if (!checkAdminCredentials(username, password)) {
    return NextResponse.json({ success: false, message: '用户名或密码错误' }, { status: 401 });
  }

  createAdminSession();
  return NextResponse.json({ success: true });
}
