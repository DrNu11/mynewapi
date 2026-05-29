// Admin client for NewAPI — search user by email, get user by id, update group
const NEWAPI_BASE = (process.env.NEWAPI_BASE || 'https://api.nassaapi.xyz').replace(/\/+$/, '');
const NEWAPI_ADMIN_TOKEN = process.env.NEWAPI_ADMIN_TOKEN || '';
const NEWAPI_ADMIN_USER_ID = process.env.NEWAPI_ADMIN_USER_ID || '1';

if (!NEWAPI_ADMIN_TOKEN) {
  console.warn('[newapi] NEWAPI_ADMIN_TOKEN is empty — API calls will fail.');
}

interface NewApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

interface NewApiUser {
  id: number;
  username: string;
  email: string;
  group: string;
  status: number;
  role: number;
  quota: number;
  [k: string]: unknown;
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<NewApiResponse<T>> {
  const url = `${NEWAPI_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: NEWAPI_ADMIN_TOKEN,
      'New-Api-User': NEWAPI_ADMIN_USER_ID,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
  const text = await res.text();
  let body: NewApiResponse<T>;
  try {
    body = JSON.parse(text) as NewApiResponse<T>;
  } catch {
    throw new Error(`NewAPI ${path} non-json: HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

export async function searchUserByEmail(email: string): Promise<NewApiUser | null> {
  // /api/user/search?keyword=xxx — admin-only
  const body = await adminFetch<NewApiUser[] | { items?: NewApiUser[] }>(
    `/api/user/search?keyword=${encodeURIComponent(email)}`,
  );
  if (!body.success) return null;
  const list: NewApiUser[] = Array.isArray(body.data)
    ? body.data
    : body.data && Array.isArray((body.data as { items?: NewApiUser[] }).items)
      ? (body.data as { items: NewApiUser[] }).items
      : [];
  // exact email match (search may return prefix matches)
  return list.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

export async function getUserById(id: number): Promise<NewApiUser | null> {
  const body = await adminFetch<NewApiUser>(`/api/user/${id}`);
  return body.success && body.data ? body.data : null;
}

export async function updateUserGroup(userId: number, newGroup: string): Promise<void> {
  // PUT /api/user/ requires the FULL user object; fetch first then mutate
  const user = await getUserById(userId);
  if (!user) throw new Error(`user ${userId} not found`);
  const payload = { ...user, group: newGroup };
  const body = await adminFetch<unknown>('/api/user/', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!body.success) throw new Error(body.message || 'update user failed');
}
