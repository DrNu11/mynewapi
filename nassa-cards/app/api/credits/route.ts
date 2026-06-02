import { NextRequest, NextResponse } from 'next/server';
import { countActivatedCardsForTokenPlan, getCardByCode } from '@/lib/db';
import { getTokenById } from '@/lib/newapi';
import { PLAN_BY_ID, isPlanId } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** NewAPI 内部单位:1 USD = 500000 quota */
const QUOTA_PER_USD = 500000;
const GPT_WEEKLY_PLAN = '7d';
const GPT_WEEKLY_QUOTA_USD = 1000;
const GPT_PRO_PLAN = '30d-unlimited';

/** 仅允许 GPT 周卡 / GPT 尊享套餐查询 */
function creditPlanBaseTotalUSD(category: string | null, plan: string): number | null {
  if (category !== 'gpt') return null;
  if (plan === GPT_WEEKLY_PLAN) return GPT_WEEKLY_QUOTA_USD;
  if (plan === GPT_PRO_PLAN) return PLAN_BY_ID[GPT_PRO_PLAN].quotaUSD ?? 2000;
  return null;
}

/** 简易 IP 限速:同 IP 每分钟最多 12 次查询 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const ipHits = new Map<string, number[]>();

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  return (xff.split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim();
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  ipHits.set(ip, arr);
  // 防泄漏:超过 1000 IP 时清理
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits.entries()) {
      if (v.length === 0 || now - v[v.length - 1] > RATE_LIMIT_WINDOW_MS) ipHits.delete(k);
    }
  }
  return true;
}

function maskCode(code: string): string {
  // GP-R8AC-GGHR-FK4Q -> GP-R8AC-****-FK4Q
  const parts = code.split('-');
  if (parts.length >= 4) {
    parts[2] = '****';
    return parts.join('-');
  }
  return code.slice(0, 7) + '-****';
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { success: false, message: '查询过于频繁,请稍后再试' },
      { status: 429 }
    );
  }

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const code = (body.code || '').trim().toUpperCase();
  if (!code || code.length < 8 || code.length > 32) {
    return NextResponse.json({ success: false, message: '请输入正确的卡密' }, { status: 400 });
  }

  const card = getCardByCode(code);
  // 统一脱敏错误信息:防止枚举卡密
  const denyMsg = '卡密不存在或不在 GPT 额度查询范围';

  if (!card) {
    return NextResponse.json({ success: false, message: denyMsg }, { status: 404 });
  }
  const baseTotalUSD = creditPlanBaseTotalUSD(card.category, card.plan);
  if (baseTotalUSD === null) {
    return NextResponse.json({ success: false, message: denyMsg }, { status: 403 });
  }
  if (card.status !== 'activated') {
    return NextResponse.json(
      { success: false, message: '该卡密尚未激活,请先在主页激活' },
      { status: 400 }
    );
  }
  if (!card.newapi_token_id) {
    return NextResponse.json(
      { success: false, message: '该卡密未绑定 token,请联系客服' },
      { status: 500 }
    );
  }

  // 拉 NewAPI 真实余量
  let token: Awaited<ReturnType<typeof getTokenById>>;
  try {
    token = await getTokenById(card.newapi_token_id, card.newapi_user_id);
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: `查询额度失败: ${e?.message || e}` },
      { status: 502 }
    );
  }

  const planMeta = isPlanId(card.plan) ? PLAN_BY_ID[card.plan] : null;
  const totalUSD = card.category === 'gpt' && card.plan === GPT_WEEKLY_PLAN
    ? Math.max(
      GPT_WEEKLY_QUOTA_USD,
      countActivatedCardsForTokenPlan({
        tokenId: card.newapi_token_id,
        tokenKey: card.newapi_token_key,
        category: 'gpt',
        plan: GPT_WEEKLY_PLAN,
      }) * GPT_WEEKLY_QUOTA_USD,
    )
    : baseTotalUSD;
  const remainQuota = Number(token.remain_quota || 0);
  const usedQuotaRaw = Number((token as Record<string, unknown>).used_quota || 0);
  // 极少数情况下 used_quota 不返回,用 totalUSD * QUOTA_PER_USD - remain_quota 兜底
  const usedQuota = usedQuotaRaw > 0
    ? usedQuotaRaw
    : Math.max(0, totalUSD * QUOTA_PER_USD - remainQuota);

  const remainUSD = remainQuota / QUOTA_PER_USD;
  const usedUSD = usedQuota / QUOTA_PER_USD;
  const usagePct = totalUSD > 0 ? Math.min(100, (usedUSD / totalUSD) * 100) : 0;

  return NextResponse.json({
    success: true,
    data: {
      code_masked: maskCode(card.code),
      plan_label: planMeta?.label || card.plan,
      activated_at: card.activated_at,
      last_used_at: typeof token.accessed_time === 'number' ? token.accessed_time : null,
      no_expire: !!planMeta?.noExpire,
      total_usd: totalUSD,
      used_usd: Math.round(usedUSD * 10000) / 10000, // 4 位小数
      remain_usd: Math.round(remainUSD * 10000) / 10000,
      usage_pct: Math.round(usagePct * 100) / 100,
      // 给前端展示的状态判定
      status: token.status === 1 ? 'enabled' : 'disabled',
    },
  });
}
