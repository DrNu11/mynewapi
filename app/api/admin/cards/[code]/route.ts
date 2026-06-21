import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import {
  applyGlmReviewBonus,
  applyRphBonus,
  clearGlmReviewBonus,
  clearRphBonus,
  getCardByCode,
  isGlmReviewBonusEligible,
  isRphBonusEligible,
  setCardNewApiUserId,
  setCardPool,
  setCardStatus,
} from '@/lib/db';
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
 *   { action: 'set_newapi_user_id', newapi_user_id: number | "" } — 设置/清除 NewAPI 用户归属
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
  let body: {
    action?: string;
    pool?: string;
    newapi_user_id?: number | string | null;
    disable_reason?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const action = body.action;
  if (
    action !== 'disable' &&
    action !== 'enable' &&
    action !== 'set_pool' &&
    action !== 'set_newapi_user_id' &&
    action !== 'apply_rph_bonus' &&
    action !== 'clear_rph_bonus' &&
    action !== 'apply_glm_review_bonus' &&
    action !== 'clear_glm_review_bonus'
  ) {
    return NextResponse.json(
      { success: false, message: 'action 不支持' },
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

  // RPH 加成 (当前仅 deepseek 1d/7d/30d, 好评 +55)
  if (action === 'apply_rph_bonus') {
    if (!isRphBonusEligible(card)) {
      return NextResponse.json(
        { success: false, message: '该卡不支持 RPH 加成。', error: { message: '该卡不支持 RPH 加成。', type: 'invalid_request_error', code: 'rph_bonus_not_allowed' } },
        { status: 400 }
      );
    }
    const updated = applyRphBonus(code);
    return NextResponse.json({ success: true, data: { card: updated } });
  }

  // 撤销 RPH 加成
  if (action === 'clear_rph_bonus') {
    const updated = clearRphBonus(code);
    return NextResponse.json({ success: true, data: { card: updated } });
  }

  // GLM 好评 +500 请求次数奖励;独立于 DeepSeek RPH 加成
  if (action === 'apply_glm_review_bonus') {
    if (!isGlmReviewBonusEligible(card)) {
      return NextResponse.json(
        { success: false, message: '该卡不支持 GLM 好评请求额度奖励。', error: { message: '该卡不支持 GLM 好评请求额度奖励。', type: 'invalid_request_error', code: 'glm_bonus_not_allowed' } },
        { status: 400 }
      );
    }
    const updated = applyGlmReviewBonus(code);
    return NextResponse.json({ success: true, data: { card: updated } });
  }

  if (action === 'clear_glm_review_bonus') {
    const updated = clearGlmReviewBonus(code);
    if (!updated) {
      return NextResponse.json(
        { success: false, message: '该卡不支持 GLM 好评请求额度奖励。', error: { message: '该卡不支持 GLM 好评请求额度奖励。', type: 'invalid_request_error', code: 'glm_bonus_not_allowed' } },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, data: { card: updated } });
  }

  // 设置 NewAPI 用户归属。未激活卡会在激活时按该用户创建 token;已激活卡只更新本地标注。
  if (action === 'set_newapi_user_id') {
    const raw = body.newapi_user_id;
    const userId = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) {
      return NextResponse.json({ success: false, message: 'NewAPI 用户 ID 必须是正整数' }, { status: 400 });
    }
    const updated = setCardNewApiUserId(code, userId);
    const warning = card.newapi_token_id
      ? '这张卡已激活,本次只更新 card 后台标注;NewAPI 既有 token 和历史日志不会迁移。'
      : null;
    return NextResponse.json({ success: true, data: { card: updated, warning } });
  }

  // 联动 NewAPI token 状态(若已激活/绑定 token)
  if (card.newapi_token_id) {
    try {
      await updateTokenStatus(card.newapi_token_id, action === 'disable' ? 2 : 1, card.newapi_user_id);
    } catch (e: any) {
      console.error('[admin/cards] NewAPI token status update failed', e);
      return NextResponse.json(
        { success: false, message: `NewAPI 联动失败: ${e?.message || e}` },
        { status: 502 }
      );
    }
  }

  // 本地 cards.status 切换
  const updated = setCardStatus(code, action, action === 'disable' ? body.disable_reason ?? null : null);
  return NextResponse.json({ success: true, data: { card: updated } });
}
