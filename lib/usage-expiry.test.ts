import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import { POST } from '@/app/api/usage/route';
import { db, insertCard } from './db';

const CODE = 'GL-USAGE-PERM-CARD';
const TOKEN = 'sk-usage-permanent-test';

afterEach(() => {
  db().prepare('DELETE FROM cards WHERE code = ?').run(CODE);
});

describe('/api/usage live card state', () => {
  it('returns null expiry for a permanent card', async () => {
    const now = Math.floor(Date.now() / 1000);
    insertCard({
      code: CODE,
      plan: '1d',
      plan_days: 1,
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
      status: 'activated',
      created_at: now,
      activated_at: now,
      expires_at: null,
      claimed_at: null,
      newapi_user_id: null,
      newapi_token_id: 4321,
      newapi_token_key: TOKEN,
      activator_ip: null,
      disable_reason: null,
      notes: null,
    });

    const response = await POST(new NextRequest('http://localhost/api/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sk: TOKEN }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.expires_at).toBeNull();
  });
});
