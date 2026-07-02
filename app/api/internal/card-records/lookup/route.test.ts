import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from './route';
import { db, insertCard, type Card } from '@/lib/db';

const SECRET = 'test-internal-secret';
const CODES = {
  week: 'GL-WEEK-ABCD-EFGH',
  day: 'GL-DAYA-ABCD-EFGH',
};

function insertLookupCard(opts: {
  code: string;
  plan: '1d' | '7d' | '30d';
  tokenId?: number | null;
  userId?: number | null;
}) {
  const now = Math.floor(Date.now() / 1000);
  const planDays = opts.plan === '30d' ? 30 : opts.plan === '7d' ? 7 : 1;
  insertCard({
    code: opts.code,
    plan: opts.plan,
    plan_days: planDays,
    category: 'glm',
    rph: 500,
    rph_bonus: 0,
    rph_bonus_reason: null,
    rph_bonus_at: null,
    request_quota: 500,
    request_bonus_quota: 0,
    request_bonus_reason: null,
    request_bonus_at: null,
    video_quota: 1,
    video_bonus_quota: 0,
    pool: null,
    status: 'activated' as Card['status'],
    created_at: now,
    activated_at: now,
    expires_at: now + planDays * 86400,
    claimed_at: null,
    newapi_user_id: opts.userId ?? 5678,
    newapi_token_id: opts.tokenId ?? 1234,
    newapi_token_key: 'sk-secret-must-not-leak',
    activator_ip: null,
    disable_reason: null,
    notes: null,
  });
}

function request(cardCode: string, secret = SECRET) {
  return new NextRequest('http://localhost/api/internal/card-records/lookup', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ card_code: cardCode }),
  });
}

beforeEach(() => {
  process.env.NASSA_INTERNAL_API_SECRET = SECRET;
  db().prepare('DELETE FROM cards WHERE code IN (?, ?)').run(CODES.week, CODES.day);
});

afterEach(() => {
  db().prepare('DELETE FROM cards WHERE code IN (?, ?)').run(CODES.week, CODES.day);
  delete process.env.NASSA_INTERNAL_API_SECRET;
});

describe('POST /api/internal/card-records/lookup', () => {
  it('requires the internal bearer secret', async () => {
    insertLookupCard({ code: CODES.week, plan: '7d' });

    const response = await POST(request(CODES.week, 'wrong-secret'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.code).toBe('unauthorized');
  });

  it('returns only masked weekly card metadata', async () => {
    insertLookupCard({ code: CODES.week, plan: '7d', tokenId: 1234, userId: 5678 });

    const response = await POST(request(CODES.week));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.card).toMatchObject({
      code_masked: 'GL-WEEK-****-EFGH',
      category: 'glm',
      plan: '7d',
      plan_days: 7,
      newapi_token_id: 1234,
      newapi_user_id: 5678,
    });
    expect(JSON.stringify(body)).not.toContain('sk-secret-must-not-leak');
    expect(JSON.stringify(body)).not.toContain(CODES.week);
  });

  it('rejects daily cards', async () => {
    insertLookupCard({ code: CODES.day, plan: '1d' });

    const response = await POST(request(CODES.day));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: 'unsupported_plan',
      message: '当前仅支持周卡/月卡查看调用记录。',
    });
  });

  it('returns not_found for unknown cards', async () => {
    const response = await POST(request(CODES.week));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      success: false,
      code: 'not_found',
      message: '卡密不存在',
    });
  });
});
