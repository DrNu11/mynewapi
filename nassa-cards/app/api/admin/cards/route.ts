import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { insertCard, listCards, markExpiredCards, getStats, getRequestCountsByCardIds } from '@/lib/db';
import { generateCodes } from '@/lib/codes';
import { isPlanId, PLAN_BY_ID, makePlanFromDays } from '@/lib/plans';
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
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const cards = listCards({ status, plan, limit, offset });
  const stats = getStats();

  // 给每张卡附上"近 1 小时实际请求数"(限速观测用)
  const counts = getRequestCountsByCardIds(cards.map((c) => c.id), 3600);
  const enriched = cards.map((c) => ({ ...c, used_1h: counts[c.id] || 0 }));

  return NextResponse.json({ success: true, data: { cards: enriched, stats } });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthenticated()) return unauthorized();

  let body: {
    plan?: string;
    category?: string;
    count?: number;
    notes?: string;
    /** 自定义天数,优先级高于 plan;省略或 0 则用 plan */
    custom_days?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const { plan = '', category = '', count = 0, notes = '', custom_days } = body;

  // 校验:custom_days 优先(允许 1-3650 天 = 10 年),否则用 plan
  let planMeta;
  if (custom_days !== undefined && custom_days !== null && custom_days !== 0) {
    if (!Number.isInteger(custom_days) || custom_days < 1 || custom_days > 3650) {
      return NextResponse.json(
        { success: false, message: '自定义天数须为 1-3650 整数' },
        { status: 400 }
      );
    }
    planMeta = makePlanFromDays(custom_days);
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
  const rph = CATEGORIES[cat].defaultRPH;
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
        status: 'unused',
        created_at: now,
        activated_at: null,
        expires_at: null,
        claimed_at: null,
        newapi_token_id: null,
        newapi_token_key: null,
        activator_ip: null,
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
