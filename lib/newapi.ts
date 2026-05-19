/**
 * NewAPI 管理 API 客户端
 *
 * 注意: NewAPI 的 POST /api/token/ 创建 token 后不返回 id 或 key,
 * 必须先按 name 搜索定位 id,再调 POST /api/token/:id/key 获取 key。
 *
 * 认证: Authorization: <access_token>  +  New-Api-User: <user_id>
 */

interface NewApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
}

function env(key: string, required = true): string {
  const v = process.env[key];
  if (required && !v) throw new Error(`Missing env: ${key}`);
  return v || '';
}

function authHeaders(): Record<string, string> {
  return {
    'Authorization': env('NEWAPI_ACCESS_TOKEN'),
    'New-Api-User': env('NEWAPI_USER_ID'),
    'Content-Type': 'application/json',
  };
}

const REQUEST_TIMEOUT_MS = 15000;

async function call<T = any>(path: string, init: RequestInit = {}): Promise<NewApiResponse<T>> {
  const base = env('NEWAPI_BASE_URL').replace(/\/$/, '');
  const url = `${base}${path}`;
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers as Record<string, string> || {}) },
      cache: 'no-store',
      signal: ctl.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`NewAPI 请求超时(>${REQUEST_TIMEOUT_MS}ms)`);
    throw new Error(`NewAPI 网络错误: ${e?.message || e}`);
  } finally {
    clearTimeout(tid);
  }
  let body: NewApiResponse<T>;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`NewAPI 响应非 JSON: ${res.status} ${res.statusText}`);
  }
  if (!res.ok) {
    throw new Error(`NewAPI HTTP ${res.status}: ${body?.message || res.statusText}`);
  }
  if (body.success === false) {
    throw new Error(`NewAPI 错误: ${body.message || '未知错误'}`);
  }
  return body;
}

export interface CreateTokenInput {
  /** 令牌名(用于后续按 name 搜索定位) */
  name: string;
  /** 过期 Unix 时间戳(秒);-1 表示永不过期 */
  expired_time: number;
  /** 限定可用模型列表(逗号分隔) */
  model_limits: string;
  /** 渠道分组,默认 default */
  group?: string;
}

/** 创建 token (NewAPI 不返回 id/key,需要后续 search 找到) */
export async function createToken(input: CreateTokenInput): Promise<void> {
  await call('/api/token/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      expired_time: input.expired_time,
      remain_quota: 0,
      unlimited_quota: true,
      model_limits_enabled: true,
      model_limits: input.model_limits,
      group: input.group ?? 'default',
      cross_group_retry: false,
      allow_ips: '',
    }),
  });
}

interface NewApiTokenSummary {
  id: number;
  name: string;
  status: number;
  created_time: number;
  expired_time: number;
}

/** 按 name 搜索 token,返回 id;若未找到返回 null */
export async function findTokenIdByName(name: string): Promise<number | null> {
  const body = await call<{ items?: NewApiTokenSummary[]; records?: NewApiTokenSummary[] } | NewApiTokenSummary[]>(
    `/api/token/search?keyword=${encodeURIComponent(name)}`
  );
  // NewAPI 返回结构可能是 {data: {items: [...]}} 或 {data: [...]} 或 {data: {records: [...]}}
  let items: NewApiTokenSummary[] = [];
  const data: any = body.data;
  if (Array.isArray(data)) items = data;
  else if (Array.isArray(data?.items)) items = data.items;
  else if (Array.isArray(data?.records)) items = data.records;
  const exact = items.find((t) => t.name === name);
  return exact ? exact.id : null;
}

/** 重试找 token id;DB 主从延迟时第一次可能找不到 */
async function findTokenIdWithRetry(name: string, attempts = 5, delayMs = 250): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const id = await findTokenIdByName(name);
    if (id !== null) return id;
  }
  return null;
}

/** 根据 id 获取完整 sk-xxx key */
export async function getTokenKey(tokenId: number): Promise<string> {
  const body = await call<{ key: string }>(`/api/token/${tokenId}/key`, { method: 'POST' });
  const raw = body.data?.key;
  if (!raw) throw new Error('NewAPI 未返回 token key');
  // NewAPI 返回的 key 不带 sk- 前缀,客户端调用时必须带前缀,这里统一补上
  return raw.startsWith('sk-') ? raw : `sk-${raw}`;
}

/** 删除 token (用于清理过期或激活失败的 token) */
export async function deleteToken(tokenId: number): Promise<void> {
  await call(`/api/token/${tokenId}`, { method: 'DELETE' });
}

/**
 * 更新 token 状态 (1=enabled, 2=disabled)
 * 走 PUT /api/token/?status_only=1, 只改 status 字段, 不动 quota/expired_time 等。
 */
export async function updateTokenStatus(tokenId: number, status: 1 | 2): Promise<void> {
  await call(`/api/token/?status_only=1`, {
    method: 'PUT',
    body: JSON.stringify({ id: tokenId, status }),
  });
}

/**
 * 端到端创建 token 并返回完整 sk-xxx key
 * 失败时尝试清理已创建的孤儿 token
 */
export async function createTokenAndGetKey(
  name: string,
  daysValid: number,
  modelLimits: string
): Promise<{ id: number; key: string; expiredAt: number }> {
  const expiredAt = Math.floor(Date.now() / 1000) + daysValid * 86400;
  await createToken({ name, expired_time: expiredAt, model_limits: modelLimits });

  // 重试找 id (默认 5 次 × 250ms = 最多等 1s)
  const id = await findTokenIdWithRetry(name);
  if (!id) {
    // 这是个严重的孤儿场景:NewAPI 已经创建了 token 但我们找不到。
    // 没法清理,只能告警,需要人工到 NewAPI 后台搜该 name 处理。
    throw new Error(`创建 token 后无法定位 id (name=${name}),请到 NewAPI 后台手动清理`);
  }

  try {
    const key = await getTokenKey(id);
    return { id, key, expiredAt };
  } catch (e) {
    // 拿不到 key,清理孤儿 token
    try { await deleteToken(id); } catch (delErr) {
      console.error(`[newapi] 清理孤儿 token ${id} 失败`, delErr);
    }
    throw e;
  }
}
