/**
 * 后台管理员会话 - HMAC 签名 cookie。
 *
 * 特点：
 *   - 用 Web Crypto API（Edge runtime + Node runtime 都能跑）
 *   - 签名 cookie 自包含，无需服务端存储 session 表
 *   - 默认 30 天有效，可改 ADMIN_SESSION_DAYS
 *
 * Cookie 值格式：<usernameEnc>.<expiresAtMs>.<base64url HMAC-SHA256(payload)>
 */

export const SESSION_COOKIE_NAME = "nassaapi_admin_session";
const DEFAULT_SESSION_DAYS = 30;
const MIN_SECRET_LEN = 16;

export interface SessionPayload {
  username: string;
  expiresAt: number;
}

function envSessionDays(): number {
  const raw = process.env.ADMIN_SESSION_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SESSION_DAYS;
}

export function getSessionMaxAgeSeconds(): number {
  return envSessionDays() * 24 * 60 * 60;
}

function getSecret(): string {
  const explicit = process.env.ADMIN_SESSION_SECRET;
  if (explicit && explicit.length >= MIN_SECRET_LEN) return explicit;
  // 兼容：未设 SECRET 时从 ADMIN_PASSWORD 派生（够稳，但改密码会让所有人下线）
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    throw new Error(
      "Either ADMIN_SESSION_SECRET (>=16 chars) or ADMIN_PASSWORD must be set"
    );
  }
  return `nassaapi-admin-session::${pw}`;
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < buf.length; i++) str += String.fromCharCode(buf[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return base64UrlEncode(sig);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function createSessionToken(username: string): Promise<string> {
  const expiresAt = Date.now() + getSessionMaxAgeSeconds() * 1000;
  const payload = `${encodeURIComponent(username)}.${expiresAt}`;
  const sig = await hmacSha256(payload, getSecret());
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [usernameEnc, expiresAtStr, sig] = parts;
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  const expectedSig = await hmacSha256(`${usernameEnc}.${expiresAt}`, secret);
  if (!timingSafeEqual(sig, expectedSig)) return null;
  let username: string;
  try {
    username = decodeURIComponent(usernameEnc);
  } catch {
    return null;
  }
  return { username, expiresAt };
}

export interface AdminAccount {
  username: string;
  password: string;
}

/**
 * 读取所有合法的管理员账号。
 *
 * 来源：
 *   1. ADMIN_USERNAME + ADMIN_PASSWORD       (主账号)
 *   2. ADMIN_USERS_EXTRA (JSON 数组)          (代理商等额外账号)
 *
 * ADMIN_USERS_EXTRA 例子：
 *   [{"username":"admin2","password":"deepseek2"},{"username":"agent3","password":"xxx"}]
 */
export function getAdminAccounts(): AdminAccount[] {
  const accounts: AdminAccount[] = [];

  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (u && p) accounts.push({ username: u, password: p });

  const extra = process.env.ADMIN_USERS_EXTRA;
  if (extra && extra.trim()) {
    try {
      const parsed = JSON.parse(extra);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item.username === "string" &&
            typeof item.password === "string" &&
            item.username.length > 0 &&
            item.password.length > 0
          ) {
            accounts.push({
              username: item.username,
              password: item.password,
            });
          }
        }
      }
    } catch {
      // 解析失败忽略 - 不要让登录系统挂掉
    }
  }

  return accounts;
}

/** 常量时间比对，挨个账号试。 */
export function checkAdminCredentials(
  username: string,
  password: string
): boolean {
  const accounts = getAdminAccounts();
  for (const acc of accounts) {
    if (
      timingSafeEqual(username, acc.username) &&
      timingSafeEqual(password, acc.password)
    ) {
      return true;
    }
  }
  return false;
}
