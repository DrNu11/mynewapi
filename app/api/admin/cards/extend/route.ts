import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getCardByCode, extendCardExpiry } from '@/lib/db';
import { updateTokenExpiredTimeInDb } from '@/lib/newapi-db';
import { normalizeCode } from '@/lib/codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

/**
 * POST /api/admin/cards/extend
 * Body: { code: string, days: number }
 * 延长卡密到期时间, 保留原 API key 不变.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  let body: { code?: string; days?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = normalizeCode(body.code || '');
  if (!code) {
    return NextResponse.json({ success: false, message: '请输入卡密' }, { status: 400 });
  }

  const days = Number(body.days);
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return NextResponse.json({ success: false, message: '续期天数须为 0.01 ~ 3650' }, { status: 400 });
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }

  if (!card.newapi_token_id || !card.newapi_token_key) {
    return NextResponse.json(
      { success: false, message: '该卡尚未激活, 无法续期。请先激活后重试。' },
      { status: 400 }
    );
  }

  // 新到期时间: 若已过期从现在算, 否则从原到期时间延长
  const now = Math.floor(Date.now() / 1000);
  const base = card.expires_at && card.expires_at > now ? card.expires_at : now;
  const newExpiresAt = base + Math.round(days * 86400);

  try {
    await updateTokenExpiredTimeInDb(card.newapi_token_id, newExpiresAt);
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: `NewAPI token 续期失败: ${e?.message || e}` },
      { status: 502 }
    );
  }

  const updated = extendCardExpiry(code, newExpiresAt);
  if (!updated) {
    return NextResponse.json({ success: false, message: '续期后读取卡密失败' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      card: updated,
      before_expires_at: card.expires_at,
      after_expires_at: newExpiresAt,
      added_days: days,
    },
  });
}
