import { describe, it, expect, beforeEach } from 'vitest';

import { CATEGORIES, categoryFromCode, isCategory, modelsForCategory } from './categories';
import {
  GLM_PLAN_IDS,
  getGlmBaseRequestQuota,
  isGlmPlanId,
} from './glm-plans';
import { PLAN_BY_ID } from './plans';
import {
  GLM_BASE_REQUEST_QUOTA,
  GLM_REVIEW_BONUS_REQUEST_QUOTA,
  applyGlmReviewBonus,
  applyRphBonus,
  clearGlmReviewBonus,
  countCardBillableRequestsSince,
  db,
  getBaseRequestQuota,
  getEffectiveRequestQuota,
  getGlmRequestUsage,
  insertCard,
  isGlmReviewBonusEligible,
  type Card,
} from './db';

const HOUR = 3600;
const DAY = 24 * HOUR;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function insertTestCard(opts: {
  code?: string;
  category: string;
  plan?: string;
  status?: Card['status'];
  requestQuota?: number | null;
  requestBonusQuota?: number;
  rphBonus?: number;
}): { id: number; code: string; activatedAt: number; sk: string } {
  const now = nowSec();
  const plan = opts.plan ?? '1d';
  const planDays = (PLAN_BY_ID as Record<string, { days: number }>)[plan]?.days ?? 1;
  const code =
    opts.code ??
    `${opts.category === 'glm' ? 'GL' : 'DE'}-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const sk = `sk-glm-test-${Math.random().toString(36).slice(2, 10)}`;
  const id = insertCard({
    code,
    plan,
    plan_days: planDays,
    category: opts.category,
    rph: 500,
    rph_bonus: opts.rphBonus ?? 0,
    rph_bonus_reason: null,
    rph_bonus_at: null,
    request_quota: opts.requestQuota ?? (opts.category === 'glm' ? GLM_BASE_REQUEST_QUOTA : null),
    request_bonus_quota: opts.requestBonusQuota ?? 0,
    request_bonus_reason: opts.requestBonusQuota ? 'good_review' : null,
    request_bonus_at: opts.requestBonusQuota ? now : null,
    video_quota: 1,
    video_bonus_quota: 0,
    pool: null,
    status: opts.status ?? 'activated',
    created_at: now,
    activated_at: now,
    expires_at: now + planDays * DAY,
    claimed_at: null,
    newapi_user_id: null,
    newapi_token_id: 999,
    newapi_token_key: sk,
    activator_ip: null,
    disable_reason: null,
    notes: null,
  });
  return { id, code, activatedAt: now, sk };
}

function seedRequests(cardId: number, sk: string, total: number, status: number): void {
  const inst = db();
  const now = nowSec();
  const stmt = inst.prepare(
    'INSERT INTO request_logs (sk_key, card_id, ts, status, model) VALUES (?, ?, ?, ?, ?)',
  );
  const tx = inst.transaction(() => {
    for (let i = 0; i < total; i += 1) {
      stmt.run(sk, cardId, now, status, 'glm-5.2');
    }
  });
  tx();
}

beforeEach(() => {
  db().exec("DELETE FROM request_logs WHERE sk_key LIKE 'sk-glm-test-%'");
  db().exec("DELETE FROM cards WHERE code LIKE 'GL-TEST-%' OR code LIKE 'DE-TEST-%'");
});

describe('GLM category', () => {
  it('registers GLM category and GL prefix', () => {
    expect(isCategory('glm')).toBe(true);
    expect(CATEGORIES.glm.prefix).toBe('GL');
    expect(categoryFromCode('GL-ABCD-EFGH-JKLM')).toBe('glm');
    expect(modelsForCategory('glm')).toEqual(['glm-5.2']);
  });

  it('supports day, week, and month plans with the same fixed request quota', () => {
    expect(GLM_PLAN_IDS).toEqual(['1d', '7d', '30d']);
    expect(GLM_PLAN_IDS.every(isGlmPlanId)).toBe(true);
    expect(GLM_PLAN_IDS.map((plan) => PLAN_BY_ID[plan].days)).toEqual([1, 7, 30]);
    expect(GLM_PLAN_IDS.map(getGlmBaseRequestQuota)).toEqual([500, 500, 500]);
  });
});

describe('GLM request quota', () => {
  it('defaults to 500 requests and no bonus', () => {
    const { code } = insertTestCard({ category: 'glm' });
    const card = db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card;
    expect(getBaseRequestQuota(card)).toBe(500);
    expect(card.request_bonus_quota).toBe(0);
    expect(getEffectiveRequestQuota(card)).toBe(500);
  });

  it.each(['7d', '30d'])('keeps the fixed 500-request quota for the %s plan', (plan) => {
    const { code } = insertTestCard({ category: 'glm', plan });
    const card = db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card;

    expect(card.plan_days).toBe(PLAN_BY_ID[plan as '7d' | '30d'].days);
    expect(getBaseRequestQuota(card)).toBe(500);
    expect(getGlmRequestUsage(card).effectiveRequestQuota).toBe(500);
    expect(isGlmReviewBonusEligible(card)).toBe(true);
  });

  it('applies +166 review bonus without touching RPH bonus', () => {
    const { code } = insertTestCard({ category: 'glm' });
    const updated = applyGlmReviewBonus(code);
    expect(updated).not.toBeNull();
    expect(updated!.request_bonus_quota).toBe(GLM_REVIEW_BONUS_REQUEST_QUOTA);
    expect(updated!.request_bonus_reason).toBe('good_review');
    expect(updated!.rph_bonus).toBe(0);
    expect(getEffectiveRequestQuota(updated!)).toBe(666);
  });

  it('does not stack repeated review bonus', () => {
    const { code } = insertTestCard({ category: 'glm' });
    applyGlmReviewBonus(code);
    applyGlmReviewBonus(code);
    const updated = applyGlmReviewBonus(code);
    expect(updated!.request_bonus_quota).toBe(GLM_REVIEW_BONUS_REQUEST_QUOTA);
    expect(getEffectiveRequestQuota(updated!)).toBe(666);
  });

  it('clears review bonus', () => {
    const { code } = insertTestCard({ category: 'glm' });
    applyGlmReviewBonus(code);
    const cleared = clearGlmReviewBonus(code);
    expect(cleared!.request_bonus_quota).toBe(0);
    expect(cleared!.request_bonus_reason).toBeNull();
    expect(cleared!.request_bonus_at).toBeNull();
    expect(getEffectiveRequestQuota(cleared!)).toBe(500);
  });

  it('does not allow GLM review bonus for other categories', () => {
    const { code } = insertTestCard({ category: 'deepseek' });
    expect(applyGlmReviewBonus(code)).toBeNull();
    expect(clearGlmReviewBonus(code)).toBeNull();
  });

  it('does not let DeepSeek RPH bonus affect GLM request bonus', () => {
    const { code } = insertTestCard({ category: 'glm' });
    expect(applyRphBonus(code)).toBeNull();
    const card = db().prepare('SELECT * FROM cards WHERE code = ?').get(code) as Card;
    expect(card.rph_bonus).toBe(0);
    expect(card.request_bonus_quota).toBe(0);
  });

  it('excludes expired and disabled GLM cards from review bonus', () => {
    expect(isGlmReviewBonusEligible({ category: 'glm', plan: '1d', status: 'expired' })).toBe(false);
    expect(isGlmReviewBonusEligible({ category: 'glm', plan: '1d', status: 'disabled' })).toBe(false);
  });
});

describe('GLM request usage boundaries', () => {
  it('499 successful requests are below the base quota', () => {
    const { id, sk, activatedAt } = insertTestCard({ category: 'glm' });
    seedRequests(id, sk, 499, 200);
    expect(countCardBillableRequestsSince(id, activatedAt)).toBe(499);
    expect(getGlmRequestUsage(db().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card).remainingRequests).toBe(1);
  });

  it('500 successful requests exhaust the base quota', () => {
    const { id, sk, activatedAt } = insertTestCard({ category: 'glm' });
    seedRequests(id, sk, 500, 200);
    expect(countCardBillableRequestsSince(id, activatedAt)).toBe(500);
    expect(getGlmRequestUsage(db().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card).remainingRequests).toBe(0);
  });

  it('999 successful requests are below the review-bonus quota', () => {
    const { id, sk, activatedAt } = insertTestCard({ category: 'glm', requestBonusQuota: 500 });
    seedRequests(id, sk, 999, 200);
    expect(countCardBillableRequestsSince(id, activatedAt)).toBe(999);
    expect(getGlmRequestUsage(db().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card).remainingRequests).toBe(1);
  });

  it('1000 successful requests exhaust the review-bonus quota', () => {
    const { id, sk, activatedAt } = insertTestCard({ category: 'glm', requestBonusQuota: 500 });
    seedRequests(id, sk, 1000, 200);
    expect(countCardBillableRequestsSince(id, activatedAt)).toBe(1000);
    expect(getGlmRequestUsage(db().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card).remainingRequests).toBe(0);
  });

  it('failed upstream requests do not consume GLM request quota', () => {
    const { id, sk, activatedAt } = insertTestCard({ category: 'glm' });
    seedRequests(id, sk, 10, 502);
    expect(countCardBillableRequestsSince(id, activatedAt)).toBe(0);
    expect(getGlmRequestUsage(db().prepare('SELECT * FROM cards WHERE id = ?').get(id) as Card).remainingRequests).toBe(500);
  });
});
