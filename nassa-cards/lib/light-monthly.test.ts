import { describe, it, expect } from 'vitest';
import {
  insertCard,
  countCardWeightedPoints,
  getDeepSeekLightRequestWeight,
  db,
  type Card,
} from './db';

/**
 * DeepSeek 轻度月卡加权点数测试。
 *
 * 套餐规则:
 *   - flash=1点, pro=3点
 *   - 近 24h 滚动窗口: 2000 点
 *   - 近 7d  滚动窗口: 10000 点
 *   - 整卡总量(从激活起): 40000 点
 */

const LIGHT_24H_LIMIT = 2000;
const LIGHT_7D_LIMIT = 10000;
const LIGHT_LIFETIME_LIMIT = 40000;

const HOUR = 3600;
const DAY = 24 * HOUR;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function insertLightCard(opts: { activatedAtAgoSec?: number } = {}): { id: number; sk: string; activatedAt: number } {
  const now = nowSec();
  const activatedAt = now - (opts.activatedAtAgoSec ?? 5 * DAY);
  const sk = `sk-light-${Math.random().toString(36).slice(2, 10)}`;
  const id = insertCard({
    code: `DE-LITE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    plan: '30d_light',
    plan_days: 30,
    category: 'deepseek',
    rph: 500,
    video_quota: 0,
    video_bonus_quota: 0,
    pool: null,
    status: 'activated',
    created_at: activatedAt,
    activated_at: activatedAt,
    expires_at: activatedAt + 30 * DAY,
    claimed_at: null,
    newapi_user_id: null,
    newapi_token_id: 9999,
    newapi_token_key: sk,
    activator_ip: null,
    disable_reason: null,
    notes: null,
  } as Omit<Card, 'id'>);
  return { id, sk, activatedAt };
}

/** 批量 INSERT 带 model 字段(控制权重) */
function seedRequestsWithModel(
  sk: string, cardId: number, n: number, model: string, withinSec: number
): void {
  if (n <= 0) return;
  const now = nowSec();
  const inst = db();
  inst.exec('BEGIN');
  const stmt = inst.prepare(
    'INSERT INTO request_logs (sk_key, card_id, ts, status, model) VALUES (?, ?, ?, ?, ?)'
  );
  for (let i = 0; i < n; i++) {
    const ts = now - Math.floor((i / n) * withinSec);
    stmt.run(sk, cardId, ts, 0, model);
  }
  inst.exec('COMMIT');
}

describe('getDeepSeekLightRequestWeight', () => {
  it('flash = 1', () => {
    expect(getDeepSeekLightRequestWeight('deepseek-v4-flash')).toBe(1);
  });
  it('pro = 3', () => {
    expect(getDeepSeekLightRequestWeight('deepseek-v4-pro')).toBe(3);
  });
  it('null/unknown = 1', () => {
    expect(getDeepSeekLightRequestWeight(null)).toBe(1);
    expect(getDeepSeekLightRequestWeight('unknown-model')).toBe(1);
  });
});

describe('加权点数 - 24h 边界 (flash=1点)', () => {
  it('flash 1999 点 → 允许', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 1999, 'deepseek-v4-flash', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(1999);
    expect(used >= LIGHT_24H_LIMIT).toBe(false);
  });

  it('flash 2000 点 → 拦截', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 2000, 'deepseek-v4-flash', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(2000);
    expect(used >= LIGHT_24H_LIMIT).toBe(true);
  });
});

describe('加权点数 - 24h 边界 (pro=3点)', () => {
  it('pro 666 次 = 1998 点 → 允许', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 666, 'deepseek-v4-pro', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(1998);
    expect(used >= LIGHT_24H_LIMIT).toBe(false);
  });

  it('pro 667 次 = 2001 点 → 拦截', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 667, 'deepseek-v4-pro', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(2001);
    expect(used >= LIGHT_24H_LIMIT).toBe(true);
  });
});

describe('加权点数 - flash+pro 混用', () => {
  it('100 flash(100点) + 633 pro(1899点) = 1999点 → 允许', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 100, 'deepseek-v4-flash', 23 * HOUR);
    seedRequestsWithModel(sk, id, 633, 'deepseek-v4-pro', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(1999);
    expect(used >= LIGHT_24H_LIMIT).toBe(false);
  });

  it('101 flash(101点) + 633 pro(1899点) = 2000点 → 拦截', () => {
    const { id, sk } = insertLightCard();
    seedRequestsWithModel(sk, id, 101, 'deepseek-v4-flash', 23 * HOUR);
    seedRequestsWithModel(sk, id, 633, 'deepseek-v4-pro', 23 * HOUR);
    const used = countCardWeightedPoints(id, nowSec() - DAY);
    expect(used).toBe(2000);
    expect(used >= LIGHT_24H_LIMIT).toBe(true);
  });
});

describe('加权点数 - 7d 边界', () => {
  it('10000 点 → 拦截', () => {
    const { id, sk } = insertLightCard({ activatedAtAgoSec: 6 * DAY });
    seedRequestsWithModel(sk, id, 10000, 'deepseek-v4-flash', 6 * DAY);
    const used = countCardWeightedPoints(id, nowSec() - 7 * DAY);
    expect(used).toBe(10000);
    expect(used >= LIGHT_7D_LIMIT).toBe(true);
  });
});

describe('加权点数 - 总量边界', () => {
  it('40000 点 → 拦截', { timeout: 30000 }, () => {
    const { id, sk, activatedAt } = insertLightCard({ activatedAtAgoSec: 20 * DAY });
    seedRequestsWithModel(sk, id, 40000, 'deepseek-v4-flash', 19 * DAY);
    const used = countCardWeightedPoints(id, activatedAt);
    expect(used).toBe(40000);
    expect(used >= LIGHT_LIFETIME_LIMIT).toBe(true);
  });
});

describe('加权点数 - 空卡', () => {
  it('空卡为 0 点', () => {
    const { id } = insertLightCard();
    expect(countCardWeightedPoints(id, nowSec() - DAY)).toBe(0);
  });
});
