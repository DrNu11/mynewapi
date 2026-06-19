import { NextResponse } from 'next/server';

import { getPublicStatusSnapshot } from '@/lib/public-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const snapshot = await getPublicStatusSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
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
