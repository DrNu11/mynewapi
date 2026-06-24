import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════
// Import the mask utils from the script
// Since it's a tsx script (not a module), we duplicate the pure functions here for testing
// ═══════════════════════════════════════════════════════

// --- Inlined from daily-usage-risk-report.ts for unit test isolation ---

function maskCard(code: string): string {
  if (!code) return code;
  const parts = code.split('-');
  if (parts.length >= 4) {
    parts[2] = '****';
    return parts.join('-');
  }
  if (code.length > 8) return code.slice(0, 4) + '-****-' + code.slice(-4);
  return code;
}

function maskSkKey(sk: string): string {
  if (!sk || sk.length <= 16) return sk;
  return sk.slice(0, 8) + '****' + sk.slice(-4);
}

function maskIP(ip: string): string {
  if (!ip || ip === 'unknown') return ip || 'unknown';
  if (ip.includes(':')) {
    return ip.split(':').slice(0, 2).join(':') + ':****';
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    parts[3] = 'xxx';
    return parts.join('.');
  }
  return ip;
}

const QUOTA_PER_USD = 500000;

function quotaToUsd(q: number): number {
  return Math.round((q / QUOTA_PER_USD) * 100) / 100;
}

function concurrencyRisk(peakRpm: number): string {
  if (peakRpm >= 50) return '严重';
  if (peakRpm >= 20) return '高';
  if (peakRpm >= 5) return '中';
  return '低';
}

function beijingTodayStartSeconds(nowMs?: number): number {
  const now = Math.floor((nowMs ?? Date.now()) / 1000);
  const offset = 8 * 3600;
  return Math.floor((now + offset) / 86400) * 86400 - offset;
}

function beijingDateString(nowMs?: number): string {
  return new Date((nowMs ?? Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════
// maskCard tests
// ═══════════════════════════════════════════════════════

describe('maskCard', () => {
  it('脱敏标准格式卡密 GP-826A-SGZB-P74U', () => {
    expect(maskCard('GP-826A-SGZB-P74U')).toBe('GP-826A-****-P74U');
  });

  it('脱敏 DE 前缀卡密', () => {
    expect(maskCard('DE-V2Q5-MNTR-Y9CE')).toBe('DE-V2Q5-****-Y9CE');
  });

  it('脱敏 CL 前缀卡密', () => {
    expect(maskCard('CL-4EC9-PQZK-C5SZ')).toBe('CL-4EC9-****-C5SZ');
  });

  it('脱敏 GL 前缀卡密', () => {
    expect(maskCard('GL-7B2F-X5M9-KRUN')).toBe('GL-7B2F-****-KRUN');
  });

  it('空字符串返回空', () => {
    expect(maskCard('')).toBe('');
  });

  it('非标准格式短卡密不崩溃', () => {
    const result = maskCard('SHORT');
    expect(result).toBeTruthy();
    // 短字符串(<4 parts to split)会被原样返回，但不会崩溃
    expect(typeof result).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════
// maskSkKey tests
// ═══════════════════════════════════════════════════════

describe('maskSkKey', () => {
  it('脱敏标准 sk 密钥', () => {
    expect(maskSkKey('sk-MXU4zDYtGWHby95sIz6lTcnJkrBayReeSamtmXSIDYTPjG6A'))
      .toBe('sk-MXU4z****jG6A');
  });

  it('短密钥(≤16字符)原样返回', () => {
    expect(maskSkKey('sk-short')).toBe('sk-short');
  });

  it('空密钥不崩溃', () => {
    expect(maskSkKey('')).toBe('');
  });

  it('密钥脱敏后不包含完整中间段', () => {
    const result = maskSkKey('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result).toContain('****');
    expect(result.startsWith('sk-')).toBe(true);
    expect(result.length).toBeLessThan(20); // 远小于原长度
  });
});

// ═══════════════════════════════════════════════════════
// maskIP tests
// ═══════════════════════════════════════════════════════

describe('maskIP', () => {
  it('IPv4 最后一位脱敏', () => {
    expect(maskIP('117.151.92.68')).toBe('117.151.92.xxx');
  });

  it('IPv6 脱敏', () => {
    expect(maskIP('2408:8220:191b:b2b0:49fe:c710:ea3c:5abe'))
      .toBe('2408:8220:****');
  });

  it('unknown 原样返回', () => {
    expect(maskIP('unknown')).toBe('unknown');
  });

  it('空 IP 不崩溃', () => {
    expect(maskIP('')).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════
// quotaToUsd tests
// ═══════════════════════════════════════════════════════

describe('quotaToUsd', () => {
  it('500000 quota = $1.00', () => {
    expect(quotaToUsd(500000)).toBe(1.00);
  });

  it('0 quota = $0.00', () => {
    expect(quotaToUsd(0)).toBe(0.00);
  });

  it('125021797 quota ≈ $250.04', () => {
    expect(quotaToUsd(125021797)).toBe(250.04);
  });

  it('$1000 = 500000000 quota', () => {
    expect(quotaToUsd(500000000)).toBe(1000.00);
  });

  it('1 quota 不会崩溃', () => {
    expect(quotaToUsd(1)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════
// concurrencyRisk tests
// ═══════════════════════════════════════════════════════

describe('concurrencyRisk', () => {
  it('1 rpm = 低', () => expect(concurrencyRisk(1)).toBe('低'));
  it('4 rpm = 低', () => expect(concurrencyRisk(4)).toBe('低'));
  it('5 rpm = 中', () => expect(concurrencyRisk(5)).toBe('中'));
  it('19 rpm = 中', () => expect(concurrencyRisk(19)).toBe('中'));
  it('20 rpm = 高', () => expect(concurrencyRisk(20)).toBe('高'));
  it('49 rpm = 高', () => expect(concurrencyRisk(49)).toBe('高'));
  it('50 rpm = 严重', () => expect(concurrencyRisk(50)).toBe('严重'));
  it('100 rpm = 严重', () => expect(concurrencyRisk(100)).toBe('严重'));
});

// ═══════════════════════════════════════════════════════
// beijingTodayStartSeconds tests
// ═══════════════════════════════════════════════════════

describe('beijingTodayStartSeconds', () => {
  it('返回的时间戳对齐到北京当天 00:00', () => {
    // 2026-06-23 12:00:00 UTC = 2026-06-23 20:00:00 Beijing
    const noonUTC = new Date('2026-06-23T12:00:00Z').getTime();
    const start = beijingTodayStartSeconds(noonUTC);
    // should be 2026-06-23 00:00 Beijing = 2026-06-22 16:00:00 UTC
    expect(start).toBe(new Date('2026-06-22T16:00:00Z').getTime() / 1000);
  });

  it('北京时间 00:00:00 本身就在当天起点', () => {
    // 2026-06-22 16:00:00 UTC = 2026-06-23 00:00:00 Beijing
    const midnightBJ = new Date('2026-06-22T16:00:00Z').getTime();
    const start = beijingTodayStartSeconds(midnightBJ);
    expect(start).toBe(midnightBJ / 1000);
  });

  it('北京时间 23:59:59 仍在同一天起点', () => {
    // 2026-06-22T15:59:59Z = 2026-06-22 23:59:59 Beijing
    // → start should be 2026-06-22 00:00 Beijing = 2026-06-21 16:00 UTC
    const late = new Date('2026-06-22T15:59:59Z').getTime();
    const start = beijingTodayStartSeconds(late);
    expect(start).toBe(new Date('2026-06-21T16:00:00Z').getTime() / 1000);
  });
});

// ═══════════════════════════════════════════════════════
// beijingDateString tests
// ═══════════════════════════════════════════════════════

describe('beijingDateString', () => {
  it('UTC 中午 → 北京时间同一天', () => {
    // 2026-06-23 12:00 UTC = 2026-06-23 20:00 Beijing
    const noonUTC = new Date('2026-06-23T12:00:00Z').getTime();
    expect(beijingDateString(noonUTC)).toBe('2026-06-23');
  });

  it('UTC 凌晨 → 北京时间同一天', () => {
    // 2026-06-23 02:00 UTC = 2026-06-23 10:00 Beijing
    const early = new Date('2026-06-23T02:00:00Z').getTime();
    expect(beijingDateString(early)).toBe('2026-06-23');
  });
});
