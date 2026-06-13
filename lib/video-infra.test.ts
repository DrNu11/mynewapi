import { describe, test, expect } from 'vitest';
import { todayStartSeconds, currentBusinessDate } from './db';

describe('todayStartSeconds', () => {
  test('返回北京时间当天 0 点 unix 秒', () => {
    const result = todayStartSeconds();
    // 验证是秒级时间戳 (小于 Date.now()/1000 的正常值)
    expect(result).toBeGreaterThan(1700000000);
    expect(result).toBeLessThan(Date.now() / 1000 + 1);
    // 当天 0 点应该是 86400 的整数倍(相对 UTC+8)
    const offset = 8 * 3600;
    expect((result + offset) % 86400).toBe(0);
  });
});

describe('currentBusinessDate', () => {
  test('返回 YYYY-MM-DD 格式的北京时间日期', () => {
    const result = currentBusinessDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = result.split('-').map(Number);
    expect(y).toBeGreaterThanOrEqual(2026);
    expect(m).toBeGreaterThanOrEqual(1);
    expect(m).toBeLessThanOrEqual(12);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(31);
  });
});
