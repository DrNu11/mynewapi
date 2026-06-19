import { describe, it, expect, beforeEach } from 'vitest';
import {
  doApply,
  doClear,
  doDisable,
  doStatus,
  DE_PATTERN,
  CODE_PATTERN,
} from '../scripts/card-admin-cli';
import { insertCard, db, type Card } from './db';

const DAY = 24 * 3600;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function insertTestCard(plan: string, category: string, status: string = 'activated', rph: number = 500): { code: string; id: number } {
  const now = nowSec();
  const code = `DE-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const id = insertCard({
    code,
    plan,
    plan_days: plan === '7d' ? 7 : plan === '30d' || plan === '30d_light' ? 30 : 1,
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
    activated_at: status === 'activated' ? now : null,
    expires_at: status === 'expired' ? now - 1 : now + 30 * DAY,
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
  db().exec("DELETE FROM cards WHERE code LIKE 'DE-%' AND code NOT LIKE 'DE-RCZ4%' AND code NOT LIKE 'DE-SS93%'");
});

// ==================== format validation ====================

describe('format validation', () => {
  it('DE 卡密匹配 DE_PATTERN', () => {
    expect(DE_PATTERN.test('DE-ABCD-EFGH-IJKL')).toBe(true);
    expect(DE_PATTERN.test('DE-1234-5678-9ABC')).toBe(true);
  });

  it('非 DE 前缀不匹配 DE_PATTERN', () => {
    expect(DE_PATTERN.test('GP-ABCD-EFGH-IJKL')).toBe(false);
    expect(DE_PATTERN.test('CL-ABCD-EFGH-IJKL')).toBe(false);
  });

  it('多余文字不匹配 DE_PATTERN', () => {
    expect(DE_PATTERN.test('撤回 DE-ABCD-EFGH-IJKL')).toBe(false);
    expect(DE_PATTERN.test('查询 DE-ABCD-EFGH-IJKL')).toBe(false);
    expect(DE_PATTERN.test('你好 DE-ABCD-EFGH-IJKL')).toBe(false);
  });

  it('通用 CODE_PATTERN 匹配所有类型卡密', () => {
    expect(CODE_PATTERN.test('DE-ABCD-EFGH-IJKL')).toBe(true);
    expect(CODE_PATTERN.test('GP-ABCD-EFGH-IJKL')).toBe(true);
    expect(CODE_PATTERN.test('CL-ABCD-EFGH-IJKL')).toBe(true);
  });

  it('非法格式被 CODE_PATTERN 拒绝', () => {
    expect(CODE_PATTERN.test('DE-ABCD-EFGH')).toBe(false);
    expect(CODE_PATTERN.test('ABCD-EFGH-IJKL-MNOP-QRST')).toBe(false);
    expect(CODE_PATTERN.test('')).toBe(false);
    expect(CODE_PATTERN.test('撤回 DE-ABCD-EFGH-IJKL')).toBe(false);
  });
});

// ==================== apply-rph ====================

describe('apply-rph', () => {
  it('DeepSeek 1d 添加好评 +55 成功', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    const out = doApply(code);
    expect(out[0]).toContain('已为');
    expect(out[0]).toContain(code);
    expect(out[1]).toContain('→ 实际 RPH: 555');
  });

  it('DeepSeek 7d 添加好评 +55 成功', () => {
    const { code } = insertTestCard('7d', 'deepseek', 'activated', 30);
    const out = doApply(code);
    expect(out[0]).toContain('已为');
    expect(out[1]).toContain('→ 实际 RPH: 85');
  });

  it('DeepSeek 30d 添加好评 +55 成功', () => {
    const { code } = insertTestCard('30d', 'deepseek', 'activated', 30);
    const out = doApply(code);
    expect(out[0]).toContain('已为');
    expect(out[1]).toContain('→ 实际 RPH: 85');
  });

  it('重复 apply-rph 不叠加', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    doApply(code);
    const out = doApply(code);
    expect(out[0]).toContain('已为');
    expect(out[1]).toContain('→ 实际 RPH: 555');
  });

  it('30d_light apply-rph 被拒绝', () => {
    const { code } = insertTestCard('30d_light', 'deepseek', 'activated', 500);
    const out = doApply(code);
    expect(out[0]).toContain('不符合好评 +55 条件');
  });

  it('GPT apply-rph 被拒绝', () => {
    const { code } = insertTestCard('1d', 'gpt', 'activated', 400);
    const out = doApply(code);
    expect(out[0]).toContain('仅支持 DeepSeek 套餐');
  });

  it('Claude apply-rph 被拒绝', () => {
    const { code } = insertTestCard('1d', 'claude', 'activated', 100);
    const out = doApply(code);
    expect(out[0]).toContain('仅支持 DeepSeek 套餐');
  });

  it('expired apply-rph 被拒绝', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'expired', 500);
    const out = doApply(code);
    expect(out[0]).toContain('卡已过期');
  });

  it('disabled apply-rph 被拒绝', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'disabled', 500);
    const out = doApply(code);
    expect(out[0]).toContain('卡已禁用');
  });

  it('不存在的卡密', () => {
    const out = doApply('DE-XXXX-YYYY-ZZZZ');
    expect(out[0]).toContain('不存在');
  });
});

// ==================== clear-rph ====================

describe('clear-rph', () => {
  it('clear-rph 成功后 RPH 恢复基础值', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    doApply(code);
    const out = doClear(code);
    expect(out[0]).toContain('已撤销');
    expect(out[1]).toContain('500');
  });

  it('clear 后可重新 apply-rph', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    doApply(code);
    doClear(code);
    const out = doApply(code);
    expect(out[0]).toContain('已为');
    expect(out[1]).toContain('→ 实际 RPH: 555');
  });

  it('对未加成卡 clear 不报错', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    const out = doClear(code);
    expect(out[0]).toContain('已撤销');
  });
});

// ==================== disable ====================

describe('disable', () => {
  it('disable 成功', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    const out = doDisable(code);
    expect(out[0]).toContain('已禁用');
    expect(out[1]).toContain('activated → disabled');
  });

  it('unused 卡也可 disable', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'unused', 500);
    const out = doDisable(code);
    expect(out[0]).toContain('已禁用');
    expect(out[1]).toContain('unused → disabled');
  });

  it('已 disabled 卡再次 disable 提示', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'disabled', 500);
    const out = doDisable(code);
    expect(out[0]).toContain('已经被禁用');
  });

  it('disable 后 apply-rph 被拒绝', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    doDisable(code);
    const out = doApply(code);
    expect(out[0]).toContain('卡已禁用');
  });
});

// ==================== status ====================

describe('status', () => {
  it('status 普通 DeepSeek 输出 RPH 字段', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('卡密: ' + code);
    expect(text).toContain('分类: deepseek');
    expect(text).toContain('套餐: 1天畅用');
    expect(text).toContain('状态: activated');
    expect(text).toContain('基础 RPH: 500');
    expect(text).toContain('RPH 加成:');
    expect(text).toContain('实际 RPH:');
    expect(text).toContain('当前小时已用:');
    expect(text).toContain('当前小时上限:');
    expect(text).toContain('当前小时剩余:');
    expect(text).toContain('符合好评 +55 条件: 是');
    // 不应包含轻度月卡字段
    expect(text).not.toContain('近 24 小时已用点数');
    expect(text).not.toContain('flash 每次');
  });

  it('status 30d_light 输出加权点数', () => {
    const { code } = insertTestCard('30d_light', 'deepseek', 'activated', 500);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('套餐: 轻度月卡');
    expect(text).toContain('近 24 小时已用点数:');
    expect(text).toContain('近 7 天已用点数:');
    expect(text).toContain('总已用点数:');
    expect(text).toContain('flash 每次 1 点');
    expect(text).toContain('pro 每次 3 点');
    expect(text).toContain('好评 +55 RPH：不支持轻度月卡');
    // 不应包含 RPH 字段
    expect(text).not.toContain('基础 RPH:');
    expect(text).not.toContain('当前小时已用:');
  });

  it('status 不输出 sk_key', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).not.toContain('sk-');
    expect(text).not.toContain('token_key');
  });

  it('status 显示 RPH 加成信息', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'activated', 500);
    doApply(code);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('RPH 加成: +55');
    expect(text).toContain('加成原因: good_review');
  });

  it('status expired 卡显示符合条件为否', () => {
    const { code } = insertTestCard('1d', 'deepseek', 'expired', 500);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('符合好评 +55 条件: 否');
  });

  it('status Claude 卡显示符合条件为否', () => {
    const { code } = insertTestCard('1d', 'claude', 'activated', 100);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('分类: claude');
    expect(text).toContain('符合好评 +55 条件: 否');
  });

  it('status GPT 卡显示符合条件为否', () => {
    const { code } = insertTestCard('1d', 'gpt', 'activated', 400);
    const out = doStatus(code);
    const text = out.join('\n');
    expect(text).toContain('分类: gpt');
    expect(text).toContain('符合好评 +55 条件: 否');
  });
});
