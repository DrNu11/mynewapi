import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BASE = 'https://api.nassaapi.xyz/v1';
const TIMEOUT_MS = 30000;

interface CheckRequestBody {
  modelId?: string;
  baseUrl?: string;
  apiKey?: string;
  prompt?: string;
  maxTokens?: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as CheckRequestBody;
  const modelId = body.modelId;
  const baseUrl = (body.baseUrl || process.env.NASSA_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const apiKey = body.apiKey || process.env.NASSA_API_KEY;
  const prompt = body.prompt || 'ping';
  const maxTokens = body.maxTokens ?? 10;

  if (!modelId) {
    return NextResponse.json({ status: 'fail', error: 'modelId required' }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { modelId, status: 'fail', error: 'API key missing (set NASSA_API_KEY or pass apiKey)' },
      { status: 400 }
    );
  }

  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const elapsedMs = Date.now() - start;
    const text = await resp.text();
    let data: Record<string, unknown> | { raw: string };
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const anyData = data as Record<string, unknown> & {
      error?: { message?: string } | string;
      message?: string;
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: unknown;
    };

    if (!resp.ok || anyData.error) {
      const errMsg =
        typeof anyData.error === 'object' && anyData.error?.message
          ? anyData.error.message
          : typeof anyData.error === 'string'
          ? anyData.error
          : anyData.message || `HTTP ${resp.status}`;
      return NextResponse.json({
        modelId,
        status: 'fail',
        elapsedMs,
        httpStatus: resp.status,
        error: errMsg,
        raw: data,
      });
    }

    const content = anyData.choices?.[0]?.message?.content || '';
    return NextResponse.json({
      modelId,
      status: 'ok',
      elapsedMs,
      httpStatus: resp.status,
      reply: content.slice(0, 200),
      usage: anyData.usage,
      actualModel: anyData.model,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const elapsedMs = Date.now() - start;
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      modelId,
      status: 'fail',
      elapsedMs,
      error: isTimeout ? `Timeout after ${TIMEOUT_MS / 1000}s` : msg,
    });
  }
}
