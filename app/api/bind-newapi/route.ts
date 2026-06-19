import { NextRequest, NextResponse } from 'next/server';
import { categoryFromCode } from '@/lib/categories';
import { checkRateLimit, getCardByCode, setCardNewApiUserId } from '@/lib/db';
import { isValidCodeFormat, normalizeCode } from '@/lib/codes';
import { transferTokenLogsToNewApiUser, transferTokenToNewApiUser } from '@/lib/newapi-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(`bind-newapi:${ip}`, 10, 60)) {
    return NextResponse.json(
      { success: false, message: '请求过于频繁,请稍后再试' },
      { status: 429 },
    );
  }

  let body: { code?: string; user_id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = normalizeCode(body.code || '');
  const userId = Number(body.user_id);
  if (!isValidCodeFormat(code)) {
    return NextResponse.json({ success: false, message: '卡密格式错误' }, { status: 400 });
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ success: false, message: 'NewAPI 用户 ID 必须是正整数' }, { status: 400 });
  }
  if (categoryFromCode(code) !== 'deepseek') {
    return NextResponse.json({ success: false, message: '这里只支持 DeepSeek 卡密' }, { status: 400 });
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }
  if (card.status === 'disabled') {
    return NextResponse.json({ success: false, message: '该卡密已禁用,请联系客服' }, { status: 403 });
  }
  if (card.status === 'expired') {
    return NextResponse.json({ success: false, message: '该卡密已过期,请联系客服' }, { status: 410 });
  }

  let migratedToken = false;
  let migratedLogs = 0;
  try {
    if (card.newapi_token_id) {
      await transferTokenToNewApiUser(card.newapi_token_id, userId);
      migratedLogs = await transferTokenLogsToNewApiUser(card.newapi_token_id, userId);
      migratedToken = true;
    }
    const updated = setCardNewApiUserId(code, userId);
    return NextResponse.json({
      success: true,
      data: {
        code,
        status: updated?.status ?? card.status,
        newapi_user_id: userId,
        token_migrated: migratedToken,
        logs_migrated: migratedLogs,
      },
    });
  } catch (e: any) {
    console.error('[bind-newapi] bind failed', e);
    return NextResponse.json(
      { success: false, message: e?.message || '绑定失败,请稍后重试' },
      { status: 502 },
    );
  }
}
