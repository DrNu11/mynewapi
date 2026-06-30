import { afterEach, describe, expect, it } from 'vitest';

import { db, insertCard, setCardExpiry } from './db';

const CODE = 'GL-PERM-TEST-CARD';

afterEach(() => {
  db().prepare('DELETE FROM cards WHERE code = ?').run(CODE);
});

describe('admin card expiry management', () => {
  it('makes an activated card permanent without changing its plan or request quotas', () => {
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
      expires_at: now + 86400,
      claimed_at: null,
      newapi_user_id: null,
      newapi_token_id: 1234,
      newapi_token_key: 'sk-permanent-test',
      activator_ip: null,
      disable_reason: null,
      notes: 'keep-me',
    });

    const updated = setCardExpiry(CODE, null);

    expect(updated).toMatchObject({
      code: CODE,
      status: 'activated',
      plan: '1d',
      plan_days: 1,
      expires_at: null,
      request_quota: 500,
      request_bonus_quota: 0,
      rph: 500,
      newapi_token_id: 1234,
      newapi_token_key: 'sk-permanent-test',
      notes: 'keep-me',
    });
  });
});
