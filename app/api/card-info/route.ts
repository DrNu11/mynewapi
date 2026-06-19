import { NextRequest, NextResponse } from 'next/server';
import { getCardByTokenKey } from '@/lib/db';
import { isCategory, modelsForCategory, legacyModels, CATEGORIES } from '@/lib/categories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { sk } = await req.json();
    if (!sk || !sk.trim().startsWith('sk-')) {
      return NextResponse.json({ success: false, message: '无效的 API Key' }, { status: 400 });
    }

    const card = getCardByTokenKey(sk.trim());
    if (!card) {
      return NextResponse.json({ success: false, message: '未找到该 API Key' }, { status: 404 });
    }

    if (card.status === 'disabled') {
      return NextResponse.json({ success: false, message: card.disable_reason || '此 API Key 已被禁用' }, { status: 403 });
    }
    if (card.status === 'expired' || (card.expires_at && card.expires_at <= Math.floor(Date.now() / 1000))) {
      return NextResponse.json({ success: false, message: '此 API Key 已过期' }, { status: 403 });
    }

    const category = card.category as 'deepseek' | 'gpt' | 'claude' | null;
    const category_label = category ? CATEGORIES[category].label : '经典套餐';
    const models = category ? modelsForCategory(category) : legacyModels();

    // 自动适配 Base URL: 必须与前端展示保持一致，指向代理服务的 /v1 路径
    const base_url = `${req.nextUrl.origin}${category && CATEGORIES[category].baseUrlSuffix === '' ? '' : '/v1'}`;

    return NextResponse.json({
      success: true,
      data: {
        api_key: card.newapi_token_key,
        base_url: base_url,
        plan: card.plan,
        plan_days: card.plan_days,
        category,
        category_label,
        has_codex: category === 'gpt',
        rph: card.rph,
        activated_at: card.activated_at,
        expires_at: card.expires_at,
        models,
      }
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, message: err.message || '内部错误' }, { status: 500 });
  }
}
