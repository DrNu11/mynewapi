import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getCardByCode, setCardStatus, setCardPool } from '@/lib/db';
import { updateTokenStatus } from '@/lib/newapi';
import { normalizeCode } from '@/lib/codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

/**
 * PATCH /api/admin/cards/[code]
 * Body 三种形态:
 *   { action: 'disable' | 'enable' }       — 启用/禁用卡密 + 联动 NewAPI token
 *   { action: 'set_pool', pool: string }   — 修改运营归属池(pool="" 清除)
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
  let body: { action?: string; pool?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const action = body.action;
  if (action !== 'disable' && action !== 'enable' && action !== 'set_pool') {
    return NextResponse.json(
      { success: false, message: 'action 必须是 disable / enable / set_pool' },
      { status: 400 }
    );
  }

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }

  // 只改运营池标签 — 不联动 NewAPI,快路返回
  if (action === 'set_pool') {
    const updated = setCardPool(code, body.pool ?? null);
    return NextResponse.json({ success: true, data: { card: updated } });
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
