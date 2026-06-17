import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { insertCard, listCards, listPools, markExpiredCards, getStats, getCurrentHourRequestCountsByCardIds } from '@/lib/db';
import { generateCodes } from '@/lib/codes';
import { isPlanId, PLAN_BY_ID, makePlanFromDays, MIN_CUSTOM_DAYS } from '@/lib/plans';
import { CATEGORIES, isCategory, type Category } from '@/lib/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized() {
  return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  markExpiredCards();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const plan = searchParams.get('plan') || undefined;
  const pool = searchParams.get('pool') || undefined;
  const q = (searchParams.get('q') || '').trim().slice(0, 100) || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const cards = listCards({ status, plan, pool, q, limit, offset });
  const stats = getStats();
  const pools = listPools();

  // 给每张卡附上"当前自然小时请求数",与 RPH 限速口径保持一致。
  const counts = getCurrentHourRequestCountsByCardIds(cards.map((c) => c.id));
  const enriched = cards.map((c) => ({ ...c, used_1h: counts[c.id] || 0 }));

  return NextResponse.json({ success: true, data: { cards: enriched, stats, pools } });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  let body: {
    plan?: string;
    category?: string;
    count?: number;
    notes?: string;
    /** 运营号池/批次标签(可选),存入 cards.pool */
    pool?: string;
    /** 目标 NewAPI 用户 ID(可选),激活时 token 将创建到该用户名下 */
    newapi_user_id?: number | string | null;
    /** 自定义天数,优先级高于 plan;省略或 0 则用 plan */
    custom_days?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const { plan = '', category = '', count = 0, notes = '', custom_days, pool: poolRaw } = body;
  const pool = typeof poolRaw === 'string' && poolRaw.trim() ? poolRaw.trim().slice(0, 64) : null;
  const newApiUserIdRaw = body.newapi_user_id;
  const newApiUserId =
    newApiUserIdRaw === undefined || newApiUserIdRaw === null || newApiUserIdRaw === ''
      ? null
      : Number(newApiUserIdRaw);
  if (newApiUserId !== null && (!Number.isInteger(newApiUserId) || newApiUserId <= 0)) {
    return NextResponse.json({ success: false, message: 'NewAPI 用户 ID 必须是正整数' }, { status: 400 });
  }

  // 校验:custom_days 优先(允许 0.04 天 ≈ 1 小时 ~ 3650 天 = 10 年),否则用 plan
  let planMeta;
  if (custom_days !== undefined && custom_days !== null && custom_days !== 0) {
    if (!Number.isFinite(custom_days) || custom_days < MIN_CUSTOM_DAYS || custom_days > 3650) {
      return NextResponse.json(
        { success: false, message: `自定义天数须在 ${MIN_CUSTOM_DAYS} (约 1 小时) ~ 3650 之间` },
        { status: 400 }
      );
    }
    // 归一化到 4 位小数,避免浮点尾差污染 plan id 字符串
    const normalized = Math.round(custom_days * 10000) / 10000;
    planMeta = makePlanFromDays(normalized);
  } else {
    if (!isPlanId(plan)) {
      return NextResponse.json({ success: false, message: '无效的套餐 ID' }, { status: 400 });
    }
    planMeta = PLAN_BY_ID[plan];
  }
  if (!isCategory(category)) {
    return NextResponse.json({ success: false, message: '无效的卡密分类(必须是 deepseek 或 gpt)' }, { status: 400 });
  }
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return NextResponse.json({ success: false, message: '数量须为 1-500' }, { status: 400 });
  }
  const cat: Category = category;
  // plan.rphOverride 优先(0 = 不限速),没设置则用 category.defaultRPH
  const rph = planMeta.rphOverride !== undefined ? planMeta.rphOverride : CATEGORIES[cat].defaultRPH;
  const codes = generateCodes(cat, count);
  const now = Math.floor(Date.now() / 1000);

  const inserted: string[] = [];
  for (const code of codes) {
    try {
      insertCard({
        code,
        plan: planMeta.id,
        plan_days: planMeta.days,
        category: cat,
        rph,
        rph_bonus: 0,
        rph_bonus_reason: null,
        rph_bonus_at: null,
        video_quota: 1,
        video_bonus_quota: 0,
        pool,
        status: 'unused',
        created_at: now,
        activated_at: null,
        expires_at: null,
        claimed_at: null,
        newapi_user_id: newApiUserId,
        newapi_token_id: null,
        newapi_token_key: null,
        activator_ip: null,
        disable_reason: null,
        notes: notes || null,
      });
      inserted.push(code);
    } catch (e: any) {
      // UNIQUE 冲突极小概率,跳过
      if (!String(e?.message || '').includes('UNIQUE')) throw e;
    }
  }

  return NextResponse.json({ success: true, data: { codes: inserted } });
}
