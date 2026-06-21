import { NextResponse } from 'next/server';

import { getPublicStatusSnapshot } from '@/lib/public-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const SERVER_CACHE_MS = 15_000;

let cachedAt = 0;
let cachedSnapshot: Awaited<ReturnType<typeof getPublicStatusSnapshot>> | null = null;
let inflight: Promise<Awaited<ReturnType<typeof getPublicStatusSnapshot>>> | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cachedSnapshot && now - cachedAt < SERVER_CACHE_MS) {
      return NextResponse.json(cachedSnapshot, {
        headers: {
          'cache-control': 'no-store',
        },
      });
    }

    inflight ??= getPublicStatusSnapshot();
    const snapshot = await inflight;
    cachedSnapshot = snapshot;
    cachedAt = Date.now();
    inflight = null;

    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    inflight = null;
    console.error('[public-status] snapshot failed:', error);
    return NextResponse.json(
      { success: false, message: '状态暂不可用' },
      {
        status: 503,
        headers: {
          'cache-control': 'no-store',
        },
      },
    );
  }
}
