import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertCard,
  recordRequest,
  countCardRequestsSince,
  type Card,
} from './db';

/**
 * DeepSeek 轻度月卡限额测试。
 *
 * 套餐规则:
 *   - 近 24h 滚动窗口: 2000 次
 *   - 近 7d  滚动窗口: 10000 次
 *   - 整卡总量(从激活起): 40000 次
 *
 * 这里测的是底层计数函数 countCardRequestsSince 的正确性 + 边界判断逻辑,
 * 它就是 /v1 代理层 4.3 段限额检查依赖的唯一数据源。
 */

const LIGHT_24H_LIMIT = 2000;
const LIGHT_7D_LIMIT = 10000;
const LIGHT_LIFETIME_LIMIT = 40000;

const HOUR = 3600;
const DAY = 24 * HOUR;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 插入一张已激活的 DeepSeek 轻度月卡,返回 card id + sk-key */
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

/** 给某张卡塞 n 条请求日志,时间戳落在 [now - withinSec, now] 区间内 */
function seedRequests(sk: string, cardId: number, n: number, withinSec: number): void {
  const now = nowSec();
  for (let i = 0; i < n; i++) {
    // 均匀分布在窗口内,避免全压同一秒(对 COUNT 无影响,但更真实)
    const ts = now - Math.floor((i / Math.max(1, n)) * withinSec);
    recordRequestAt(sk, cardId, ts);
  }
}

/**
 * recordRequest 内部用 Date.now(),无法指定历史时间戳。
 * 这里直接复用 recordRequest 的语义但手动控制 ts —
 * 通过临时 mock Date.now 实现。
 */
function recordRequestAt(sk: string, cardId: number, ts: number): void {
  const realNow = Date.now;
  Date.now = () => ts * 1000;
  try {
    recordRequest(sk, cardId, 0, 'deepseek-v4-flash');
  } finally {
    Date.now = realNow;
  }
}

describe('DeepSeek 轻度月卡 - countCardRequestsSince 计数', () => {
  it('空卡计数为 0', () => {
    const { id } = insertLightCard();
    expect(countCardRequestsSince(id, nowSec() - DAY)).toBe(0);
  });

  it('只统计窗口内的请求', () => {
    const { id, sk } = insertLightCard();
    // 10 条在 24h 内
    seedRequests(sk, id, 10, 23 * HOUR);
    // 5 条在 24h 之外(2 天前)
    for (let i = 0; i < 5; i++) recordRequestAt(sk, id, nowSec() - 2 * DAY);
    expect(countCardRequestsSince(id, nowSec() - DAY)).toBe(10);
  });

  it('卡之间计数互不干扰', () => {
    const a = insertLightCard();
    const b = insertLightCard();
    seedRequests(a.sk, a.id, 7, 12 * HOUR);
    seedRequests(b.sk, b.id, 3, 12 * HOUR);
    expect(countCardRequestsSince(a.id, nowSec() - DAY)).toBe(7);
    expect(countCardRequestsSince(b.id, nowSec() - DAY)).toBe(3);
  });
});

describe('DeepSeek 轻度月卡 - 24h 滚动窗口边界', () => {
  it('1999 次 → 允许(未达上限)', () => {
    const { id, sk } = insertLightCard();
    seedRequests(sk, id, 1999, 23 * HOUR);
    const used = countCardRequestsSince(id, nowSec() - DAY);
    expect(used).toBe(1999);
    expect(used >= LIGHT_24H_LIMIT).toBe(false);
  });

  it('2000 次 → 拦截(达到上限)', () => {
    const { id, sk } = insertLightCard();
    seedRequests(sk, id, 2000, 23 * HOUR);
    const used = countCardRequestsSince(id, nowSec() - DAY);
    expect(used).toBe(2000);
    expect(used >= LIGHT_24H_LIMIT).toBe(true);
  });
});

describe('DeepSeek 轻度月卡 - 7d 滚动窗口边界', () => {
  it('9999 次 → 允许', () => {
    const { id, sk } = insertLightCard({ activatedAtAgoSec: 6 * DAY });
    seedRequests(sk, id, 9999, 6 * DAY);
    const used = countCardRequestsSince(id, nowSec() - 7 * DAY);
    expect(used).toBe(9999);
    expect(used >= LIGHT_7D_LIMIT).toBe(false);
  });

  it('10000 次 → 拦截', () => {
    const { id, sk } = insertLightCard({ activatedAtAgoSec: 6 * DAY });
    seedRequests(sk, id, 10000, 6 * DAY);
    const used = countCardRequestsSince(id, nowSec() - 7 * DAY);
    expect(used).toBe(10000);
    expect(used >= LIGHT_7D_LIMIT).toBe(true);
  });
});

describe('DeepSeek 轻度月卡 - 整卡总量边界', () => {
  it('39999 次 → 允许', () => {
    const { id, sk, activatedAt } = insertLightCard({ activatedAtAgoSec: 20 * DAY });
    seedRequests(sk, id, 39999, 19 * DAY);
    const used = countCardRequestsSince(id, activatedAt);
    expect(used).toBe(39999);
    expect(used >= LIGHT_LIFETIME_LIMIT).toBe(false);
  });

  it('40000 次 → 拦截', () => {
    const { id, sk, activatedAt } = insertLightCard({ activatedAtAgoSec: 20 * DAY });
    seedRequests(sk, id, 40000, 19 * DAY);
    const used = countCardRequestsSince(id, activatedAt);
    expect(used).toBe(40000);
    expect(used >= LIGHT_LIFETIME_LIMIT).toBe(true);
  });
});

describe('DeepSeek 轻度月卡 - 窗口叠加语义', () => {
  it('总量未超但 24h 超 → 应被 24h 先拦截', () => {
    const { id, sk, activatedAt } = insertLightCard({ activatedAtAgoSec: 10 * DAY });
    // 24h 内塞满 2000(触发 24h 限制)
    seedRequests(sk, id, 2000, 23 * HOUR);
    const used24h = countCardRequestsSince(id, nowSec() - DAY);
    const usedTotal = countCardRequestsSince(id, activatedAt);
    expect(used24h >= LIGHT_24H_LIMIT).toBe(true);
    expect(usedTotal >= LIGHT_LIFETIME_LIMIT).toBe(false);
  });
});
