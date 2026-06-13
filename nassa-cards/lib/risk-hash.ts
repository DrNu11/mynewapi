import { createHmac, randomBytes } from 'crypto';

/**
 * IP 和设备 ID 的 HMAC 哈希,数据库不存原始值。
 * RISK_HASH_SECRET 至少 32 字节,缺失时降级为不可逆确定性哈希。
 */
function getSecret(): string {
  return process.env.RISK_HASH_SECRET || 'nassa-cards-risk-hash-default-secret-min-32b';
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
