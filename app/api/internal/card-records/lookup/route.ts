import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getCardByCode } from '@/lib/db';
import { isValidCodeFormat, normalizeCode } from '@/lib/codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_PLANS = new Set(['7d', '30d']);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function secretMatches(auth: string | null, secret: string): boolean {
  const prefix = 'Bearer ';
  if (!auth?.startsWith(prefix)) return false;
  const token = auth.slice(prefix.length).trim();
  const expected = Buffer.from(secret);
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function maskCardCode(code: string): string {
  const parts = code.split('-');
  if (parts.length >= 4) {
    return `${parts[0]}-${parts[1]}-****-${parts[3]}`;
  }
  if (code.length <= 8) return '****';
  return `${code.slice(0, 4)}****${code.slice(-4)}`;
}

export async function POST(req: NextRequest) {
  const secret = (process.env.NASSA_INTERNAL_API_SECRET || '').trim();
  if (!secret) {
    return json(500, {
      success: false,
      code: 'internal_secret_missing',
      message: '内部接口未配置',
    });
  }

  if (!secretMatches(req.headers.get('authorization'), secret)) {
    return json(401, {
      success: false,
      code: 'unauthorized',
      message: '未授权',
    });
  }

  let body: { card_code?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, {
      success: false,
      code: 'bad_request',
      message: '请求格式错误',
    });
  }

  const code = normalizeCode(body.card_code || '');
  if (!isValidCodeFormat(code)) {
    return json(400, {
      success: false,
      code: 'invalid_card_code',
      message: '卡密格式错误',
    });
  }

  const card = getCardByCode(code);
  if (!card) {
    return json(404, {
      success: false,
      code: 'not_found',
      message: '卡密不存在',
    });
  }

  if (!SUPPORTED_PLANS.has(card.plan)) {
    return json(400, {
      success: false,
      code: 'unsupported_plan',
      message: '当前仅支持周卡/月卡查看调用记录。',
    });
  }

  return json(200, {
    success: true,
    card: {
      code_masked: maskCardCode(card.code),
      category: card.category,
      plan: card.plan,
      plan_days: card.plan_days,
      status: card.status,
      activated_at: card.activated_at,
      expires_at: card.expires_at,
      newapi_token_id: card.newapi_token_id,
      newapi_user_id: card.newapi_user_id,
    },
  });
}
