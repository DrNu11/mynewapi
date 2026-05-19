import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getCardByCode, setCardStatus } from '@/lib/db';
import { updateTokenStatus } from '@/lib/newapi';
import { normalizeCode } from '@/lib/codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

/**
 * PATCH /api/admin/cards/[code]
 * Body: { action: 'disable' | 'enable' }
 *
 * 同时联动 NewAPI 的 token status:
 *   disable → cards.status='disabled' + NewAPI token status=2
 *   enable  → cards.status 恢复 + NewAPI token status=1
 *
 * 没绑定 NewAPI token 的卡(从未激活过)只改本地状态, 跳过 NewAPI 调用。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  if (!isAdminAuthenticated()) return unauthorized();

  const code = normalizeCode(params.code || '');
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'disable' && action !== 'enable') {
    return NextResponse.json(
      { success: false, message: 'action 必须是 disable 或 enable' },
      { status: 400 }
    );
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }

  // 联动 NewAPI token 状态(若已激活/绑定 token)
  if (card.newapi_token_id) {
    try {
      await updateTokenStatus(card.newapi_token_id, action === 'disable' ? 2 : 1);
    } catch (e: any) {
      console.error('[admin/cards] NewAPI token status update failed', e);
      return NextResponse.json(
        { success: false, message: `NewAPI 联动失败: ${e?.message || e}` },
        { status: 502 }
      );
    }
  }

  // 本地 cards.status 切换
  const updated = setCardStatus(code, action);
  return NextResponse.json({ success: true, data: { card: updated } });
}
