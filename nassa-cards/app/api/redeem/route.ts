import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getCardByCode,
  claimCard,
  releaseCardClaim,
  activateCard,
  markExpiredCards,
} from '@/lib/db';
import { isValidCodeFormat, normalizeCode } from '@/lib/codes';
import { createTokenAndGetKey } from '@/lib/newapi';
import { PLAN_BY_ID, isPlanId, type Plan } from '@/lib/plans';
import {
  CATEGORIES,
  categoryFromCode,
  isCategory,
  legacyModels,
  modelsForCategory,
  type Category,
} from '@/lib/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GPT_WEEKLY_QUOTA_USD = 1000;

function quotaForCard(category: Category | null, planId: string, planMeta?: Plan): number | undefined {
  if (category === 'gpt' && planId === '7d') return GPT_WEEKLY_QUOTA_USD;
  return planMeta?.quotaUSD;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = req.headers.get('x-real-ip');
  if (xri) return xri;
  return 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  // 防爆破: 每个 IP 每分钟最多 10 次
  if (!checkRateLimit(`redeem:${ip}`, 10, 60)) {
    return NextResponse.json(
      { success: false, message: '请求过于频繁,请稍后再试' },
      { status: 429 }
    );
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = normalizeCode(body.code || '');
  if (!isValidCodeFormat(code)) {
    return NextResponse.json(
      { success: false, message: '卡密格式错误,应为 NASSA-XXXX-XXXX-XXXX' },
      { status: 400 }
    );
  }

  // 顺手扫描过期
  markExpiredCards();

  const card = getCardByCode(code);
  if (!card) {
    return NextResponse.json({ success: false, message: '卡密不存在' }, { status: 404 });
  }

  // 解析 category(优先用数据库存的,fallback 用前缀推断;老 NASSA-* 都为 null)
  const cat: Category | null =
    isCategory(card.category) ? card.category : categoryFromCode(card.code);
  const categoryMeta = cat ? CATEGORIES[cat] : null;
  const models = cat ? modelsForCategory(cat) : legacyModels();

  // base_url 拼接：新卡(有 category)按 categoryMeta.baseUrlSuffix，
  // 老 NASSA-* 卡继续用 PUBLIC_API_BASE（完整 URL，默认带 /v1）保持零影响。
  const baseRoot = (
    process.env.PUBLIC_API_BASE_ROOT || 'https://card.nassaapi.xyz'
  ).replace(/\/$/, '');
  const legacyBase = process.env.PUBLIC_API_BASE || 'https://card.nassaapi.xyz/v1';
  const baseUrl = categoryMeta ? `${baseRoot}${categoryMeta.baseUrlSuffix}` : legacyBase;

  // 已激活: 直接返回已绑定的 key (允许客户重新查看)
  // 注意:noExpire 套餐 expires_at=NULL,不能作为守护条件,只看 status+token_key
  if (card.status === 'activated' && card.newapi_token_key) {
    return NextResponse.json({
      success: true,
      already_activated: true,
      data: {
        api_key: card.newapi_token_key,
        base_url: baseUrl,
        plan: card.plan,
        plan_days: card.plan_days,
        category: cat,
        category_label: categoryMeta?.label ?? null,
        has_codex: categoryMeta?.hasCodex ?? false,
        rph: card.rph,
        activated_at: card.activated_at,
        expires_at: card.expires_at,
        models,
      },
    });
  }

  if (card.status === 'expired') {
    return NextResponse.json(
      { success: false, message: '该卡密已过期,请联系客服' },
      { status: 410 }
    );
  }

  if (card.status === 'disabled') {
    return NextResponse.json(
      { success: false, message: card.disable_reason || '该卡密已被禁用,请联系客服' },
      { status: 403 }
    );
  }

  if (card.status === 'activating') {
    // 已被其他并发请求占领,稍后重试或同一卡密二次输入
    return NextResponse.json(
      { success: false, message: '激活进行中,请稍后重试' },
      { status: 409 }
    );
  }

  if (card.status !== 'unused') {
    return NextResponse.json(
      { success: false, message: `卡密状态异常: ${card.status}` },
      { status: 400 }
    );
  }

  // 原子占领: unused → activating
  const claimed = claimCard(code, ip);
  if (!claimed) {
    return NextResponse.json(
      { success: false, message: '激活进行中,请稍后重试' },
      { status: 409 }
    );
  }

  // 调 NewAPI 创建 token,model_limits 严格限定为该 category 模型
  // quotaUSD: GPT 周卡固定 $1000;套餐若设置(如 30d-unlimited=$2000),token 用 unlimited_quota=false + remain_quota
  // noExpire: 套餐若设置(如 30d-unlimited),NewAPI expired_time=-1 + cards.expires_at=NULL
  // 自定义天数 plan(如 '15d')不在 PLAN_BY_ID 里 → 都走旧逻辑(吃 root 池 + 30 天后过期)
  const modelLimits = models.join(',');
  const planMeta = isPlanId(card.plan) ? PLAN_BY_ID[card.plan] : undefined;
  const planQuotaUSD = quotaForCard(cat, card.plan, planMeta);
  const planNoExpire = planMeta?.noExpire ?? false;
  const planGroup = planMeta?.newapiGroup; // e.g. '30d-unlimited' → 'pro'
  let tokenInfo;
  try {
    tokenInfo = await createTokenAndGetKey(
      code,
      card.plan_days,
      modelLimits,
      planQuotaUSD,
      planNoExpire,
      planGroup,
      card.newapi_user_id,
    );
  } catch (e: any) {
    console.error('[redeem] NewAPI 调用失败', e);
    // 释放占领,允许重试
    releaseCardClaim(code);
    return NextResponse.json(
      { success: false, message: '后端开通失败,请稍后重试或联系客服' },
      { status: 502 }
    );
  }

  // activating → activated;noExpire 套餐 expires_at 写 NULL,markExpiredCards 跳过
  const cardExpiresAt = planNoExpire ? null : tokenInfo.expiredAt;
  activateCard(code, tokenInfo.id, tokenInfo.key, cardExpiresAt);

  return NextResponse.json({
    success: true,
    already_activated: false,
    data: {
      api_key: tokenInfo.key,
      base_url: baseUrl,
      plan: card.plan,
      plan_days: card.plan_days,
      category: cat,
      category_label: categoryMeta?.label ?? null,
      has_codex: categoryMeta?.hasCodex ?? false,
      rph: card.rph,
      activated_at: Math.floor(Date.now() / 1000),
      expires_at: cardExpiresAt,
      models,
    },
  });
}
