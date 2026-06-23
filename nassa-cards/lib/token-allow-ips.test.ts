import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── maskKey helper (mirrors audit-newapi-token-sync.ts logic) ───
function maskKey(sk: string): string {
  if (sk.length <= 10) return '***';
  return sk.slice(0, 6) + '****' + sk.slice(-4);
}

describe('maskKey sanitization', () => {
  it('masks a full sk-key (only shows first 6 and last 4)', () => {
    const key = 'sk-ER4QEMDBqlsC0IUVLXsSXZ1MeqgWl6D8ep0iwFHxIgm3CqXD';
    const masked = maskKey(key);
    expect(masked).toBe('sk-ER4****CqXD');
    expect(masked).not.toContain('ER4QEMDBqlsC0IUVLXsSXZ1MeqgWl6D8ep0iwFHxIgm3');
  });

  it('returns *** for keys <= 10 chars', () => {
    expect(maskKey('short')).toBe('***');
    expect(maskKey('1234567890')).toBe('***');
  });

  it('does not leak the middle of the key', () => {
    const key = 'sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD';
    const masked = maskKey(key);
    expect(masked).toBe('sk-abc****ABCD');
    expect(masked.length).toBeLessThan(key.length);
  });
});

// ── createToken allow_ips logic (testable unit) ─────────────────
function getAllowIps(env: Record<string, string | undefined>, nodeEnv?: string): string {
  const allowIps = env.NEWAPI_TOKEN_ALLOW_IPS ?? '';
  if (nodeEnv === 'production' && !allowIps) {
    throw new Error('生产环境必须配置 NEWAPI_TOKEN_ALLOW_IPS');
  }
  return allowIps;
}

describe('createToken allow_ips', () => {
  it('uses NEWAPI_TOKEN_ALLOW_IPS when set', () => {
    const ips = getAllowIps({ NEWAPI_TOKEN_ALLOW_IPS: '172.18.0.1/32' }, 'production');
    expect(ips).toBe('172.18.0.1/32');
  });

  it('allows empty in development', () => {
    const ips = getAllowIps({}, 'development');
    expect(ips).toBe('');
  });

  it('throws in production when NEWAPI_TOKEN_ALLOW_IPS is empty', () => {
    expect(() => getAllowIps({}, 'production')).toThrow('生产环境必须配置 NEWAPI_TOKEN_ALLOW_IPS');
  });

  it('throws in production when NEWAPI_TOKEN_ALLOW_IPS is undefined', () => {
    expect(() => getAllowIps({ NEWAPI_TOKEN_ALLOW_IPS: undefined }, 'production')).toThrow(
      '生产环境必须配置 NEWAPI_TOKEN_ALLOW_IPS',
    );
  });

  it('accepts CIDR format', () => {
    const ips = getAllowIps({ NEWAPI_TOKEN_ALLOW_IPS: '172.18.0.1/32' }, 'production');
    expect(ips).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
  });

  it('accepts multiple IPs comma-separated', () => {
    const ips = getAllowIps(
      { NEWAPI_TOKEN_ALLOW_IPS: '172.18.0.1/32,10.0.0.0/8' },
      'production',
    );
    expect(ips).toContain(',');
  });
});

// ── X-Forwarded-For header filtering (route.ts logic) ────────────
const HOP_BY_HOP_FILTERS = [
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'cookie',
] as const;

function shouldForwardHeader(key: string): boolean {
  const lk = key.toLowerCase();
  if (lk === 'host') return false;
  if (lk === 'connection') return false;
  if (lk === 'content-length') return false;
  if (lk === 'accept-encoding') return false;
  if (lk === 'cookie') return false;
  if (lk.startsWith('cf-')) return false;
  if (lk.startsWith('x-forwarded-')) return false;
  if (lk === 'x-real-ip') return false;
  if (lk === 'forwarded') return false;
  return true;
}

describe('header filtering (route.ts forward logic)', () => {
  it('filters x-forwarded-for', () => {
    expect(shouldForwardHeader('x-forwarded-for')).toBe(false);
  });

  it('filters x-forwarded-proto', () => {
    expect(shouldForwardHeader('x-forwarded-proto')).toBe(false);
  });

  it('filters x-real-ip', () => {
    expect(shouldForwardHeader('x-real-ip')).toBe(false);
  });

  it('filters forwarded header', () => {
    expect(shouldForwardHeader('forwarded')).toBe(false);
  });

  it('filters cf-connecting-ip', () => {
    expect(shouldForwardHeader('cf-connecting-ip')).toBe(false);
  });

  it('filters all cf- prefixed headers', () => {
    expect(shouldForwardHeader('cf-something-custom')).toBe(false);
  });

  it('allows content-type', () => {
    expect(shouldForwardHeader('content-type')).toBe(true);
  });

  it('allows authorization', () => {
    expect(shouldForwardHeader('authorization')).toBe(true);
  });

  it('allows user-agent', () => {
    expect(shouldForwardHeader('user-agent')).toBe(true);
  });

  it('case insensitive', () => {
    expect(shouldForwardHeader('X-Forwarded-For')).toBe(false);
    expect(shouldForwardHeader('X-Real-IP')).toBe(false);
    expect(shouldForwardHeader('CF-Connecting-IP')).toBe(false);
    expect(shouldForwardHeader('Forwarded')).toBe(false);
  });

  it('allows DeepSeek / GPT / Claude / GLM model-related headers', () => {
    // Generic headers that all model families use
    expect(shouldForwardHeader('content-type')).toBe(true);
    expect(shouldForwardHeader('authorization')).toBe(true);
  });

  it('filters host header', () => {
    expect(shouldForwardHeader('host')).toBe(false);
  });

  it('filters cookie', () => {
    expect(shouldForwardHeader('cookie')).toBe(false);
  });
});
