import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getCardByCode,
  getCardByTokenKey,
  claimCard,
  releaseCardClaim,
  applyRenewal,
  getRenewalByRenewalCardId,
  type Card,
} from '@/lib/db';
import { isValidCodeFormat, normalizeCode } from '@/lib/codes';
import {
  addTokenQuotaUSD,
  getTokenById,
  updateTokenExpiredTime,
} from '@/lib/newapi';
import { isPlanId, PLAN_BY_ID } from '@/lib/plans';
import {
  CATEGORIES,
  categoryFromCode,
  isCategory,
  type Category,
} from '@/lib/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GPT_WEEKLY_QUOTA_USD = 1000;

function renewalQuotaUSD(category: Category | null, plan: string): number | null {
  if (category === 'gpt' && plan === '7d') return GPT_WEEKLY_QUOTA_USD;
  return null;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri;
  return 'unknown';
}

function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, message, ...extra }, { status });
}

// 计算续费后的新到期时间.
// 严格规则:
//   base = max(now, original.expires_at)
//   new = base + planDays * 86400
// 这保证:
//   - 仍在有效期 → 严格延长 planDays 天
//   - 已经过期   → 从 now 开始算 planDays 天 (不会从过去开始算)
//   - new > now AND new > original.expires_at (基本不变量,实现里再 assert 一次)
function computeNewExpire(originalExpiresAt: number, planDays: number): {
  base: number;
  newExpire: number;
  addedSeconds: number;
} {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(originalExpiresAt) || originalExpiresAt <= 0) {
    throw new Error('非法 original.expires_at');
  }
  if (!Number.isFinite(planDays) || planDays <= 0 || planDays > 3650) {
    throw new Error('非法 plan_days');
  }
  const base = Math.max(now, originalExpiresAt);
  const newExpire = base + Math.round(planDays * 86400);
  if (newExpire <= now) throw new Error('计算结果异常: newExpire <= now');
  if (newExpire <= originalExpiresAt) throw new Error('计算结果异常: 不能缩短');
  const addedSeconds = newExpire - originalExpiresAt;
  return { base, newExpire, addedSeconds };
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // 速率限制 — 比 redeem 严:每 IP 每分钟最多 5 次
  if (!checkRateLimit(`renew:${ip}`, 5, 60)) {
    return fail('请求过于频繁,请稍后再试', 429);
  }

  let body: { sk?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return fail('请求格式错误', 400);
  }

  const sk = (body.sk || '').trim();
  if (!sk.startsWith('sk-')) return fail('请求格式错误: sk 缺失', 400);

  const renewalCode = normalizeCode(body.code || '');
  if (!isValidCodeFormat(renewalCode)) {
    return fail('续费卡密格式错误', 400);
  }

  // ===================== 校验原 card =====================
  const orig: Card | null = getCardByTokenKey(sk);
  if (!orig) return fail('未找到该 API Key 对应的卡密,请确认是否在本站激活', 404);

  if (!['activated', 'expired'].includes(orig.status)) {
    return fail(`原卡密状态异常 (${orig.status}),无法续费`, 400);
  }
  if (!orig.newapi_token_id || !orig.newapi_token_key) {
    return fail('原卡密未绑定 NewAPI token,无法续费', 400);
  }
  if (orig.expires_at === null || orig.expires_at === undefined) {
    return fail('永久套餐(尊享)无需续费', 400);
  }
  if (!isCategory(orig.category)) {
    return fail('老 NASSA-* 卡密暂不支持续费,请联系客服重新发卡', 400);
  }

  // ===================== 校验续费卡 =====================
  const renewal = getCardByCode(renewalCode);
  if (!renewal) return fail('续费卡密不存在', 404);

  if (renewal.id === orig.id) return fail('续费卡密与原卡相同,无法用于续费', 400);

  if (renewal.status !== 'unused') {
    if (renewal.status === 'activating') {
      return fail('该续费卡正在被另一请求使用,请稍后重试', 409);
    }
    if (renewal.status === 'activated' || renewal.status === 'expired') {
      // 检查是不是已经被用作过续费 (UNIQUE renewal_card_id)
      const used = getRenewalByRenewalCardId(renewal.id);
      if (used) return fail('该卡密已用于续费,无法重复使用', 409);
      return fail('续费卡密已被激活,不能用作续费', 409);
    }
    return fail(`续费卡密状态异常: ${renewal.status}`, 400);
  }

  // category 必须严格一致
  const renewalCat: Category | null = isCategory(renewal.category)
    ? renewal.category
    : categoryFromCode(renewal.code);
  if (!renewalCat || renewalCat !== orig.category) {
    const origLabel = CATEGORIES[orig.category as Category].label;
    const renewLabel = renewalCat ? CATEGORIES[renewalCat].label : '未知套餐';
    return fail(`续费卡是 ${renewLabel},与原卡 ${origLabel} 不匹配`, 400);
  }

  // 续费卡不能是 noExpire (永久卡用作续费没意义)
  if (isPlanId(renewal.plan) && PLAN_BY_ID[renewal.plan]?.noExpire) {
    return fail('永久套餐卡密不能用作续费,请直接激活', 400);
  }

  if (!Number.isFinite(renewal.plan_days) || renewal.plan_days <= 0) {
    return fail(`续费卡密 plan_days 异常: ${renewal.plan_days}`, 400);
  }

  // ===================== 计算新到期 =====================
  let plan;
  try {
    plan = computeNewExpire(orig.expires_at, renewal.plan_days);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }

  // ===================== 占领续费卡 (atomic unused → activating) =====================
  if (!claimCard(renewalCode, ip)) {
    return fail('该续费卡正在被另一请求使用,请稍后重试', 409);
  }

  // ===================== 调 NewAPI 改 token expired_time =====================
  let beforeExp: number;
  let afterExp: number;
  let quotaAdded = false;
  const addQuotaUSD = renewalQuotaUSD(renewalCat, renewal.plan);
  try {
    // 先 GET token 验证它仍存在 + 拿当前 server 端 expired_time
    const live = await getTokenById(orig.newapi_token_id, orig.newapi_user_id);
    if (live.expired_time === -1) {
      // server 端是 noExpire,客户端 cards 也应该是 NULL
      releaseCardClaim(renewalCode);
      return fail('NewAPI 端 token 是永久 token,无需续费', 400);
    }
    // server 端 token expired_time 与本地 cards.expires_at 应该一致;若不一致,
    // 以 server 为权威 — 重新计算确保严格.
    if (Number(live.expired_time) !== orig.expires_at) {
      console.warn(
        `[renew] server token.expired_time=${live.expired_time} 与 cards.expires_at=${orig.expires_at} 不一致,以 server 为准`,
      );
      try {
        plan = computeNewExpire(Number(live.expired_time), renewal.plan_days);
      } catch (e) {
        releaseCardClaim(renewalCode);
        return fail(e instanceof Error ? e.message : String(e), 500);
      }
    }

    const r = await updateTokenExpiredTime(orig.newapi_token_id, plan.newExpire, orig.newapi_user_id);
    beforeExp = r.before;
    afterExp = r.after;
    if (addQuotaUSD) {
      await addTokenQuotaUSD(orig.newapi_token_id, addQuotaUSD, orig.newapi_user_id);
      quotaAdded = true;
    }
  } catch (e) {
    console.error('[renew] NewAPI 调用失败', e);
    releaseCardClaim(renewalCode);
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`NewAPI 调用失败: ${msg}`, 502);
  }

  // 防御性 assert: server 端真实 afterExp 必须 === 我们算的 newExpire
  if (afterExp !== plan.newExpire) {
    releaseCardClaim(renewalCode);
    return fail(
      `校验失败: server 落地 ${afterExp} 与计算 ${plan.newExpire} 不一致,已回滚`,
      500,
    );
  }

  // ===================== 写库 (transaction) =====================
  let renewalId: number;
  try {
    renewalId = applyRenewal({
      originalCardId: orig.id,
      renewalCardId: renewal.id,
      beforeExpiresAt: beforeExp,
      afterExpiresAt: afterExp,
      addedDays: renewal.plan_days,
      newapiTokenId: orig.newapi_token_id,
      newapiTokenKey: orig.newapi_token_key,
      newapiUserId: orig.newapi_user_id,
      renewalIp: ip,
    });
  } catch (e) {
    // 极端情况:NewAPI 已经改了 expired_time,但本地 sqlite 写入失败.
    // 这时 NewAPI 是延期的,本地不一致 — 但客户的 token 仍然有效更长.
    // 尝试回滚 NewAPI:把 expired_time 改回 beforeExp.
    console.error('[renew] sqlite 写入失败,尝试回滚 NewAPI', e);
    try {
      await updateTokenExpiredTime(orig.newapi_token_id, beforeExp, orig.newapi_user_id);
      if (quotaAdded && addQuotaUSD) {
        await addTokenQuotaUSD(orig.newapi_token_id, -addQuotaUSD, orig.newapi_user_id);
      }
      console.error('[renew] NewAPI 回滚成功 (token expired_time 改回原值)');
    } catch (rollbackErr) {
      console.error('[renew] NewAPI 回滚也失败:', rollbackErr);
    }
    releaseCardClaim(renewalCode);
    return fail('数据库写入失败,已回滚,请稍后重试或联系客服', 500);
  }

  console.log(
    `[renew] ${ip} renewed ${orig.code} (id=${orig.id}) using ${renewal.code} (id=${renewal.id}): ` +
    `${beforeExp} → ${afterExp} (+${plan.addedSeconds}s, +${renewal.plan_days}d)`,
  );

  return NextResponse.json({
    success: true,
    data: {
      renewal_id: renewalId,
      original_code: orig.code,
      renewal_code: renewal.code,
      added_days: renewal.plan_days,
      added_seconds: plan.addedSeconds,
      before_expires_at: beforeExp,
      after_expires_at: afterExp,
      // 给 result 页用的更新值,客户端直接 patch sessionStorage 不刷新
      api_key: orig.newapi_token_key,
    },
  });
}
