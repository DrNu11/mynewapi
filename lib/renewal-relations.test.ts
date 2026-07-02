import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyGlmReviewBonus,
  applyRenewal,
  claimCard,
  clearGlmReviewBonus,
  db,
  getCardByTokenKey,
  insertCard,
  listRenewalRelationsForCardIds,
  type Card,
} from './db';

const PREFIX = 'GL-REL-';

function insertRelationCard(opts: {
  code: string;
  status: Card['status'];
  tokenId?: number | null;
  tokenKey?: string | null;
  requestQuota?: number | null;
  requestBonusQuota?: number;
  requestBonusReason?: string | null;
  rphBonus?: number;
}): number {
  const now = Math.floor(Date.now() / 1000);
  return insertCard({
    code: opts.code,
    plan: '7d',
    plan_days: 7,
    category: 'glm',
    rph: 500,
    rph_bonus: opts.rphBonus ?? 0,
    rph_bonus_reason: null,
    rph_bonus_at: null,
    request_quota: opts.requestQuota ?? null,
    request_bonus_quota: opts.requestBonusQuota ?? 0,
    request_bonus_reason: opts.requestBonusReason ?? null,
    request_bonus_at: opts.requestBonusReason ? now : null,
    video_quota: 1,
    video_bonus_quota: 0,
    pool: null,
    status: opts.status,
    created_at: now,
    activated_at: opts.status === 'activated' ? now : null,
    expires_at: opts.status === 'activated' ? now + 7 * 86400 : null,
    claimed_at: null,
    newapi_user_id: null,
    newapi_token_id: opts.tokenId ?? null,
    newapi_token_key: opts.tokenKey ?? null,
    activator_ip: null,
    disable_reason: null,
    notes: null,
  });
}

function deleteFixtureCards() {
  db().exec(`
    DELETE FROM renewals
    WHERE original_card_id IN (SELECT id FROM cards WHERE code LIKE '${PREFIX}%')
       OR renewal_card_id IN (SELECT id FROM cards WHERE code LIKE '${PREFIX}%');
    DELETE FROM cards WHERE code LIKE '${PREFIX}%';
  `);
}

beforeEach(deleteFixtureCards);
afterEach(deleteFixtureCards);

describe('renewal relations', () => {
  it('shows the renewal card on the original and the original on the renewal card', () => {
    const originalCode = `${PREFIX}ORIGINAL`;
    const renewalCode = `${PREFIX}WEEKLY`;
    const originalId = insertRelationCard({
      code: originalCode,
      status: 'activated',
      tokenId: 123,
      tokenKey: 'sk-renewal-relations',
    });
    const renewalId = insertRelationCard({ code: renewalCode, status: 'unused' });

    expect(claimCard(renewalCode, '127.0.0.1')).toBe(true);
    applyRenewal({
      originalCardId: originalId,
      renewalCardId: renewalId,
      beforeExpiresAt: 1_800_000_000,
      afterExpiresAt: 1_800_604_800,
      addedDays: 7,
      newapiTokenId: 123,
      newapiTokenKey: 'sk-renewal-relations',
      newapiUserId: null,
      renewalIp: '127.0.0.1',
    });

    const relations = listRenewalRelationsForCardIds([originalId, renewalId]);

    expect(relations[originalId].renewed_from).toBeNull();
    expect(relations[originalId].renewed_by).toEqual([
      expect.objectContaining({
        original_card_id: originalId,
        original_card_code: originalCode,
        renewal_card_id: renewalId,
        renewal_card_code: renewalCode,
        added_days: 7,
      }),
    ]);
    expect(relations[renewalId].renewed_from).toEqual(
      expect.objectContaining({
        original_card_id: originalId,
        original_card_code: originalCode,
        renewal_card_id: renewalId,
        renewal_card_code: renewalCode,
      }),
    );
    expect(relations[renewalId].renewed_by).toEqual([]);
  });

  it('transfers the GLM renewal base quota but not arbitrary bonus or hourly quotas', () => {
    const originalCode = `${PREFIX}TIME-ONLY-ORIGINAL`;
    const renewalCode = `${PREFIX}TIME-ONLY-RENEWAL`;
    const originalId = insertRelationCard({
      code: originalCode,
      status: 'activated',
      tokenId: 456,
      tokenKey: 'sk-renewal-time-only',
      requestQuota: 500,
      rphBonus: 20,
    });
    const renewalId = insertRelationCard({
      code: renewalCode,
      status: 'unused',
      requestQuota: 500,
      requestBonusQuota: 777,
      rphBonus: 300,
    });

    expect(claimCard(renewalCode, '127.0.0.1')).toBe(true);
    applyRenewal({
      originalCardId: originalId,
      renewalCardId: renewalId,
      beforeExpiresAt: 1_800_000_000,
      afterExpiresAt: 1_800_604_800,
      addedDays: 7,
      newapiTokenId: 456,
      newapiTokenKey: 'sk-renewal-time-only',
      newapiUserId: null,
      renewalIp: '127.0.0.1',
    });

    const original = db().prepare(
      'SELECT request_quota, request_bonus_quota, rph_bonus FROM cards WHERE id = ?',
    ).get(originalId) as {
      request_quota: number | null;
      request_bonus_quota: number;
      rph_bonus: number;
    };

    expect(original).toEqual({
      request_quota: 1000,
      request_bonus_quota: 0,
      rph_bonus: 20,
    });
  });

  it('transfers a pre-approved GLM review bonus from the renewal card', () => {
    const originalCode = `${PREFIX}REVIEW-ORIGINAL`;
    const renewalCode = `${PREFIX}REVIEW-RENEWAL`;
    const originalId = insertRelationCard({
      code: originalCode,
      status: 'activated',
      tokenId: 789,
      tokenKey: 'sk-renewal-review-bonus',
      requestQuota: 500,
      requestBonusQuota: 500,
    });
    const renewalId = insertRelationCard({
      code: renewalCode,
      status: 'unused',
      requestQuota: 500,
      requestBonusQuota: 500,
      requestBonusReason: 'good_review',
    });

    expect(claimCard(renewalCode, '127.0.0.1')).toBe(true);
    applyRenewal({
      originalCardId: originalId,
      renewalCardId: renewalId,
      beforeExpiresAt: 1_800_000_000,
      afterExpiresAt: 1_800_604_800,
      addedDays: 7,
      newapiTokenId: 789,
      newapiTokenKey: 'sk-renewal-review-bonus',
      newapiUserId: null,
      renewalIp: '127.0.0.1',
    });

    const original = db().prepare(
      'SELECT request_quota, request_bonus_quota FROM cards WHERE id = ?',
    ).get(originalId) as {
      request_quota: number | null;
      request_bonus_quota: number;
    };

    expect(original).toEqual({
      request_quota: 1000,
      request_bonus_quota: 666,
    });
  });

  it('applies a post-renewal GLM review bonus to the API key owner exactly once', () => {
    const originalCode = `${PREFIX}POST-REVIEW-ORIGINAL`;
    const renewalCode = `${PREFIX}POST-REVIEW-RENEWAL`;
    const tokenKey = 'sk-renewal-post-review-bonus';
    const originalId = insertRelationCard({
      code: originalCode,
      status: 'activated',
      tokenId: 987,
      tokenKey,
      requestQuota: 500,
      requestBonusQuota: 500,
    });
    const renewalId = insertRelationCard({
      code: renewalCode,
      status: 'unused',
      requestQuota: 500,
    });

    expect(claimCard(renewalCode, '127.0.0.1')).toBe(true);
    applyRenewal({
      originalCardId: originalId,
      renewalCardId: renewalId,
      beforeExpiresAt: 1_800_000_000,
      afterExpiresAt: 1_800_604_800,
      addedDays: 7,
      newapiTokenId: 987,
      newapiTokenKey: tokenKey,
      newapiUserId: null,
      renewalIp: '127.0.0.1',
    });

    expect(applyGlmReviewBonus(renewalCode)).not.toBeNull();
    expect(getCardByTokenKey(tokenKey)?.code).toBe(originalCode);
    expect(getCardByTokenKey(tokenKey)?.request_bonus_quota).toBe(666);

    expect(applyGlmReviewBonus(renewalCode)).not.toBeNull();
    expect(getCardByTokenKey(tokenKey)?.request_bonus_quota).toBe(666);

    expect(clearGlmReviewBonus(renewalCode)).not.toBeNull();
    expect(getCardByTokenKey(tokenKey)?.request_bonus_quota).toBe(500);

    expect(applyGlmReviewBonus(renewalCode)).not.toBeNull();
    expect(getCardByTokenKey(tokenKey)?.request_bonus_quota).toBe(666);
  });
});
