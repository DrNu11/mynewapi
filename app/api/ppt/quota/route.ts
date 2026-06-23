import { NextRequest, NextResponse } from 'next/server';
import { getCardByTokenKey, markExpiredCards } from '@/lib/db';
import { apiKeyFromRequest, validateSkKey } from '@/lib/ppt/api';
import { PPT_REQUEST_BASE_URL } from '@/lib/ppt/constants';
import { assertActivePptCard, getPptQuotaSnapshot, PptAccessError } from '@/lib/ppt/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

async function readBody(req: NextRequest): Promise<{ apiKey?: string }> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function handle(req: NextRequest) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const queryKey = req.nextUrl.searchParams.get('apiKey') || '';
  const apiKey = apiKeyFromRequest(req, body) || queryKey.trim();
  const keyError = validateSkKey(apiKey);
  if (keyError) return deny(keyError);

  markExpiredCards();
  const card = getCardByTokenKey(apiKey);
  if (!card) return deny('未找到该 API Key', 404);

  try {
    assertActivePptCard(card);
  } catch (e: any) {
    if (e instanceof PptAccessError) return deny(e.message, e.status);
    return deny(e?.message || '鉴权失败', 403);
  }

  const quota = getPptQuotaSnapshot(card);
  return NextResponse.json({
    success: true,
    data: {
      requestBaseUrl: PPT_REQUEST_BASE_URL,
      quota: quota.total,
      used: quota.used,
      remaining: quota.remaining,
      unlimited: quota.unlimited,
    },
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

