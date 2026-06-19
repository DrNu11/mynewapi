import { describe, it, expect, beforeEach } from 'vitest';
import {
  canUseRphBonus,
  isRphBonusEligible,
  getEffectiveRph,
  applyRphBonus,
  clearRphBonus,
  insertCard,
  db,
  type Card,
} from './db';

const HOUR = 3600;
const DAY = 24 * HOUR;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function insertTestCard(plan: string, category: string, status: string = 'activated', rph: number = 500): { code: string; id: number } {
  const now = nowSec();
  const code = `DE-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const id = insertCard({
    code,
    plan,
    plan_days: 1,
    category,
    rph,
    rph_bonus: 0,
    rph_bonus_reason: null,
    rph_bonus_at: null,
    video_quota: 1,
    video_bonus_quota: 0,
    pool: null,
    status: status as Card['status'],
    created_at: now,
    activated_at: now,
    expires_at: now + 30 * DAY,
    claimed_at: null,
    newapi_user_id: null,
    newapi_token_id: null,
    newapi_token_key: null,
    activator_ip: null,
    disable_reason: null,
    notes: null,
  });
  return { code, id };
}

beforeEach(() => {
  db().exec("DELETE FROM cards WHERE code LIKE 'DE-TEST-%'");
});

describe('canUseRphBonus', () => {
  it('deepseek 1d → true', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '1d' })).toBe(true);
  });
  it('deepseek 7d → true', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '7d' })).toBe(true);
  });
  it('deepseek 30d → true', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '30d' })).toBe(true);
  });
  it('deepseek 0.5d → false', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '0.5d' })).toBe(false);
  });
  it('deepseek 30d_light → false', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '30d_light' })).toBe(false);
  });
  it('deepseek 30d-unlimited → false', () => {
    expect(canUseRphBonus({ category: 'deepseek', plan: '30d-unlimited' })).toBe(false);
  });
  it('claude 1d → false', () => {
    expect(canUseRphBonus({ category: 'claude', plan: '1d' })).toBe(false);
  });
  it('gpt 1d → false', () => {
    expect(canUseRphBonus({ category: 'gpt', plan: '1d' })).toBe(false);
  });
  it('null category → false', () => {
    expect(canUseRphBonus({ category: null, plan: '1d' })).toBe(false);
  });
});

describe('isRphBonusEligible', () => {
  it('activated deepseek 1d → true', () => {
    expect(isRphBonusEligible({ category: 'deepseek', plan: '1d', status: 'activated' })).toBe(true);
  });
  it('expired deepseek 1d → false', () => {
    expect(isRphBonusEligible({ category: 'deepseek', plan: '1d', status: 'expired' })).toBe(false);
  });
  it('disabled deepseek 1d → false', () => {
    expect(isRphBonusEligible({ category: 'deepseek', plan: '1d', status: 'disabled' })).toBe(false);
  });
  it('deepseek 30d_light activated → false', () => {
    expect(isRphBonusEligible({ category: 'deepseek', plan: '30d_light', status: 'activated' })).toBe(false);
  });
});

describe('getEffectiveRph', () => {
  it('无加成 → 基础值', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '1d', rph: 500, rph_bonus: 0 });
    expect(rph).toBe(500);
  });

  it('deepseek 1d + 55 加成 → 555', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '1d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(555);
  });

  it('deepseek 7d + 55 加成 → 555', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '7d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(555);
  });

  it('deepseek 30d 正常月卡 + 55 加成 → 555', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '30d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(555);
  });

  it('30d_light 即使 rph_bonus=55, 也不叠加', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '30d_light', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(500);
  });

  it('0.5d 不允许加成', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '0.5d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(500);
  });

  it('claude 不允许加成', () => {
    const rph = getEffectiveRph({ category: 'claude', plan: '1d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(500);
  });

  it('gpt 不允许加成', () => {
    const rph = getEffectiveRph({ category: 'gpt', plan: '1d', rph: 500, rph_bonus: 55 });
    expect(rph).toBe(500);
  });

  it('rph 为 0 时正常计算', () => {
    const rph = getEffectiveRph({ category: 'deepseek', plan: '1d', rph: 0, rph_bonus: 55 });
    expect(rph).toBe(55);
  });
});

describe('applyRphBonus / clearRphBonus', () => {
  it('DeepSeek 1d 好评后 RPH 500 → 555', () => {
    const { code } = insertTestCard('1d', 'deepseek');
    const updated = applyRphBonus(code);
    expect(updated).not.toBeNull();
    expect(updated!.rph_bonus).toBe(55);
    expect(updated!.rph_bonus_reason).toBe('good_review');
    expect(updated!.rph_bonus_at).toBeGreaterThan(0);
    expect(getEffectiveRph(updated!)).toBe(555);
  });

  it('DeepSeek 7d 好评后 RPH 500 → 555', () => {
    const { code } = insertTestCard('7d', 'deepseek');
    const updated = applyRphBonus(code);
    expect(updated!.rph_bonus).toBe(55);
    expect(getEffectiveRph(updated!)).toBe(555);
  });

  it('DeepSeek 30d 好评后 RPH 500 → 555', () => {
    const { code } = insertTestCard('30d', 'deepseek');
    const updated = applyRphBonus(code);
    expect(updated!.rph_bonus).toBe(55);
    expect(getEffectiveRph(updated!)).toBe(555);
  });

  it('DeepSeek 0.5d 不允许加成', () => {
    const { code } = insertTestCard('0.5d', 'deepseek');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('DeepSeek 30d_light 不允许加成', () => {
    const { code } = insertTestCard('30d_light', 'deepseek');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('Claude 不允许加成', () => {
    const { code } = insertTestCard('1d', 'claude');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('GPT 不允许加成', () => {
    const { code } = insertTestCard('1d', 'gpt');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('expired 卡不允许加成', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'expired');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('disabled 卡不允许加成', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'disabled');
    const updated = applyRphBonus(code);
    expect(updated).toBeNull();
  });

  it('撤销加成后 RPH 回到基础值', () => {
    const { code } = insertTestCard('1d', 'deepseek');
    applyRphBonus(code);
    const cleared = clearRphBonus(code);
    expect(cleared).not.toBeNull();
    expect(cleared!.rph_bonus).toBe(0);
    expect(cleared!.rph_bonus_reason).toBeNull();
    expect(cleared!.rph_bonus_at).toBeNull();
    expect(getEffectiveRph(cleared!)).toBe(500);
  });

  it('重复加成不叠加', () => {
    const { code } = insertTestCard('1d', 'deepseek');
    applyRphBonus(code);
    applyRphBonus(code);
    const updated = applyRphBonus(code);
    expect(updated!.rph_bonus).toBe(55);
    expect(getEffectiveRph(updated!)).toBe(555);
  });

  it('撤销后可重新加成', () => {
    const { code } = insertTestCard('1d', 'deepseek');
    applyRphBonus(code);
    clearRphBonus(code);
    const reapplied = applyRphBonus(code);
    expect(reapplied!.rph_bonus).toBe(55);
    expect(getEffectiveRph(reapplied!)).toBe(555);
  });

  it('不存在卡 → null', () => {
    expect(applyRphBonus('DE-NOEXIST')).toBeNull();
    expect(clearRphBonus('DE-NOEXIST')).toBeNull();
  });
});
