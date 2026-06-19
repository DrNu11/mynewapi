import { createHmac, randomBytes } from 'crypto';

function getSecret(): string {
  const secret = process.env.RISK_HASH_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('RISK_HASH_SECRET is required in production');
  }

  console.warn('[risk-hash] RISK_HASH_SECRET not set, using fallback. Do NOT use in production.');
  return 'nassa-cards-risk-hash-default-secret-min-32b';
}

export function hashIp(ip: string): string {
  const normalized = normalizeIp(ip);
  return createHmac('sha256', getSecret()).update(normalized).digest('hex');
}

export function hashToken(token: string): string {
  return createHmac('sha256', getSecret()).update(token).digest('hex');
}

/** 标准化 IPv4/IPv6 地址,避免同一地址不同字面表达 */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  // IPv4-mapped IPv6 → 纯 IPv4
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}
