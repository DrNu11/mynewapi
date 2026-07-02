import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';

const COOKIE_NAME = 'nc_admin';
const SESSION_TTL = 7 * 24 * 3600; // 7 天

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function checkAdminCredentials(username: string, password: string): boolean {
  const adminUser = process.env.ADMIN_USERNAME || '';
  const adminPass = process.env.ADMIN_PASSWORD || '';
  if (!adminUser || !adminPass) return false;
  return timingSafeEqual(username, adminUser) && timingSafeEqual(password, adminPass);
}

export async function createAdminSession(): Promise<string> {
  const id = crypto.randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  db().prepare('INSERT INTO admin_sessions (id, created_at, expires_at) VALUES (?, ?, ?)')
    .run(id, now, now + SESSION_TTL);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_TTL,
  });
  return id;
}

export async function destroyAdminSession(): Promise<void> {
  const cookieStore = await cookies();
  const id = cookieStore.get(COOKIE_NAME)?.value;
  if (id) {
    db().prepare('DELETE FROM admin_sessions WHERE id = ?').run(id);
  }
  cookieStore.delete(COOKIE_NAME);
}

/** 顺手清理过期 session(每次校验时低概率触发) */
function gcSessions(): void {
  if (Math.random() > 0.05) return;
  db().prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Math.floor(Date.now() / 1000));
}

export async function isAdminAuthenticated(): Promise<boolean> {
  gcSessions();
  const cookieStore = await cookies();
  const id = cookieStore.get(COOKIE_NAME)?.value;
  if (!id) return false;
  const row = db().prepare('SELECT expires_at FROM admin_sessions WHERE id = ?').get(id) as
    | { expires_at: number }
    | undefined;
  if (!row) return false;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    db().prepare('DELETE FROM admin_sessions WHERE id = ?').run(id);
    return false;
  }
  return true;
}
