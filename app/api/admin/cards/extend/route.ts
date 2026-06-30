import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getCardByCode, setCardExpiry } from '@/lib/db';
import { updateTokenExpiredTimeInDb } from '@/lib/newapi-db';
import { normalizeCode } from '@/lib/codes';
import { CardExpiryLocalUpdateError, syncCardExpiry } from '@/lib/card-expiry-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

/**
 * POST /api/admin/cards/extend
 * Body: { code: string, days: number } 或 { code: string, permanent: true }
 * 管理卡密到期时间,保留原 API key、套餐和请求额度不变。
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  let body: { code?: string; days?: number; permanent?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = normalizeCode(body.code || '');
  if (!code) {
    return NextResponse.json({ success: false, message: '请输入卡密' }, { status: 400 });
  }

  const permanent = body.permanent === true;
  const days = permanent ? null : Number(body.days);
  if (!permanent && (days === null || !Number.isFinite(days) || days <= 0 || days > 3650)) {
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

  if (card.status === 'disabled') {
    return NextResponse.json({ success: false, message: '该卡已禁用,请先启用后再修改有效期。' }, { status: 400 });
  }

  // 新到期时间: 若已过期从现在算, 否则从原到期时间延长
  const now = Math.floor(Date.now() / 1000);
  const base = card.expires_at && card.expires_at > now ? card.expires_at : now;
  const newExpiresAt = permanent ? null : base + Math.round(Number(days) * 86400);

  let updated: NonNullable<ReturnType<typeof getCardByCode>>;
  try {
    const synced = await syncCardExpiry(
      { code, tokenId: card.newapi_token_id, expiresAt: newExpiresAt },
      {
        updateRemote: updateTokenExpiredTimeInDb,
        updateLocal: setCardExpiry,
      },
    );
    updated = synced.card;
  } catch (e: any) {
    if (e instanceof CardExpiryLocalUpdateError) {
      console.error(
        `[admin/cards/extend] 本地修改失败,NewAPI 回滚${e.rollbackSucceeded ? '成功' : '失败'}`,
        e,
      );
      return NextResponse.json(
        {
          success: false,
          message: `本地卡密修改失败,NewAPI 回滚${e.rollbackSucceeded ? '成功' : '失败'}: ${e.message}`,
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { success: false, message: `NewAPI token 到期时间修改失败: ${e?.message || e}` },
      { status: 502 }
    );
  }

  console.log(
    `[admin/cards/extend] ${permanent ? 'permanent' : 'extend'} card=${code} ` +
    `before=${card.expires_at ?? 'permanent'} after=${newExpiresAt ?? 'permanent'}`,
  );

  return NextResponse.json({
    success: true,
    data: {
      card: updated,
      before_expires_at: card.expires_at,
      after_expires_at: newExpiresAt,
      added_days: days,
      permanent,
    },
  });
}
