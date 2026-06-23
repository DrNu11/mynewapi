/**
 * NewAPI 管理 API 客户端
 *
 * 注意: NewAPI 的 POST /api/token/ 创建 token 后不返回 id 或 key,
 * 必须先按 name 搜索定位 id,再调 POST /api/token/:id/key 获取 key。
 *
 * 认证: Authorization: <access_token>  +  New-Api-User: <user_id>
 */

import {
  addTokenQuotaInDb,
  getTokenByIdFromDb,
  transferTokenToNewApiUser,
  updateTokenExpiredTimeInDb,
  updateTokenStatusInDb,
} from './newapi-db';

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

function authHeaders(userId?: number | null): Record<string, string> {
  return {
    'Authorization': env('NEWAPI_ACCESS_TOKEN'),
    'New-Api-User': String(userId ?? env('NEWAPI_USER_ID')),
    'Content-Type': 'application/json',
  };
}

const REQUEST_TIMEOUT_MS = 15000;

async function call<T = any>(
  path: string,
  init: RequestInit = {},
  userId?: number | null,
): Promise<NewApiResponse<T>> {
  const base = env('NEWAPI_BASE_URL').replace(/\/$/, '');
  const url = `${base}${path}`;
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...authHeaders(userId), ...(init.headers as Record<string, string> || {}) },
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

/** NewAPI 内部 quota 倍率:1 USD = 500000 quota */
const QUOTA_PER_USD = 500000;

export interface CreateTokenInput {
  /** 令牌名(用于后续按 name 搜索定位) */
  name: string;
  /** 过期 Unix 时间戳(秒);-1 表示永不过期 */
  expired_time: number;
  /** 限定可用模型列表(逗号分隔) */
  model_limits: string;
  /** 渠道分组,默认 default */
  group?: string;
  /** USD 额度;不传/<=0 则 unlimited_quota=true(吃 root 池) */
  quotaUSD?: number;
  /** 目标 NewAPI 用户 ID;不传则使用 NEWAPI_USER_ID */
  targetUserId?: number | null;
}

/** 创建 token (NewAPI 不返回 id/key,需要后续 search 找到)
 *
 *  token 的 allow_ips 从环境变量 NEWAPI_TOKEN_ALLOW_IPS 读取,
 *  生产环境必须配置为代理 IP(如 172.18.0.1/32),阻止客户绕过 nassa-cards 直连 NewAPI。
 *  本地开发可留空。
 */
export async function createToken(input: CreateTokenInput): Promise<void> {
  const hasQuota = typeof input.quotaUSD === 'number' && input.quotaUSD > 0;
  const allowIps = process.env.NEWAPI_TOKEN_ALLOW_IPS ?? '';
  if (process.env.NODE_ENV === 'production' && !allowIps) {
    throw new Error('生产环境必须配置 NEWAPI_TOKEN_ALLOW_IPS');
  }
  await call('/api/token/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      expired_time: input.expired_time,
      remain_quota: hasQuota ? Math.round(input.quotaUSD! * QUOTA_PER_USD) : 0,
      unlimited_quota: !hasQuota,
      model_limits_enabled: true,
      model_limits: input.model_limits,
      group: input.group ?? 'default',
      cross_group_retry: false,
      allow_ips: allowIps,
    }),
  }, input.targetUserId);
}

interface NewApiTokenSummary {
  id: number;
  name: string;
  status: number;
  created_time: number;
  expired_time: number;
}

/** 按 name 搜索 token,返回 id;若未找到返回 null */
export async function findTokenIdByName(name: string, targetUserId?: number | null): Promise<number | null> {
  const body = await call<{ items?: NewApiTokenSummary[]; records?: NewApiTokenSummary[] } | NewApiTokenSummary[]>(
    `/api/token/search?keyword=${encodeURIComponent(name)}`,
    {},
    targetUserId,
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
async function findTokenIdWithRetry(
  name: string,
  targetUserId?: number | null,
  attempts = 5,
  delayMs = 250,
): Promise<number | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    const id = await findTokenIdByName(name, targetUserId);
    if (id !== null) return id;
  }
  return null;
}

/** 根据 id 获取完整 sk-xxx key */
export async function getTokenKey(tokenId: number, targetUserId?: number | null): Promise<string> {
  const body = await call<{ key: string }>(`/api/token/${tokenId}/key`, { method: 'POST' }, targetUserId);
  const raw = body.data?.key;
  if (!raw) throw new Error('NewAPI 未返回 token key');
  // NewAPI 返回的 key 不带 sk- 前缀,客户端调用时必须带前缀,这里统一补上
  return raw.startsWith('sk-') ? raw : `sk-${raw}`;
}

/** 删除 token (用于清理过期或激活失败的 token) */
export async function deleteToken(tokenId: number, targetUserId?: number | null): Promise<void> {
  await call(`/api/token/${tokenId}`, { method: 'DELETE' }, targetUserId);
}

/**
 * 更新 token 状态 (1=enabled, 2=disabled)
 * 走 PUT /api/token/?status_only=1, 只改 status 字段, 不动 quota/expired_time 等。
 */
export async function updateTokenStatus(
  tokenId: number,
  status: 1 | 2,
  targetUserId?: number | null,
): Promise<void> {
  if (targetUserId) {
    await updateTokenStatusInDb(tokenId, status);
    return;
  }
  await call(`/api/token/?status_only=1`, {
    method: 'PUT',
    body: JSON.stringify({ id: tokenId, status }),
  }, targetUserId);
}

/** NewAPI 完整 token 对象 (PUT 时需要回传) */
interface NewApiToken {
  id: number;
  name: string;
  status: number;
  created_time: number;
  accessed_time?: number;
  expired_time: number;
  remain_quota?: number;
  unlimited_quota?: boolean;
  model_limits_enabled?: boolean;
  model_limits?: string;
  group?: string;
  cross_group_retry?: boolean;
  allow_ips?: string;
  user_id?: number;
  // 其他字段保留 raw 透传
  [k: string]: unknown;
}

/** GET /api/token/:id — 返回完整 token 对象 (NewAPI 真实 schema) */
export async function getTokenById(tokenId: number, targetUserId?: number | null): Promise<NewApiToken> {
  if (targetUserId) {
    return await getTokenByIdFromDb(tokenId) as NewApiToken;
  }
  const body = await call<NewApiToken>(`/api/token/${tokenId}`, {}, targetUserId);
  if (!body.data) throw new Error(`NewAPI token ${tokenId} 不存在或返回空`);
  return body.data;
}

/**
 * 修改 token 的 expired_time (用于续费).
 *
 * 流程:
 *   1) GET 完整 token,以 server 端真实 expired_time 为准
 *   2) PUT 完整对象,只改 expired_time 字段
 *   3) GET 校验 server 端 expired_time === newExpiredTime (防止 PUT 没生效)
 *
 * @returns { before, after } 续费前/后 unix 秒
 * @throws  PUT 后 server 端不一致 → 抛错(由调用方决定回滚)
 */
export async function updateTokenExpiredTime(
  tokenId: number,
  newExpiredTime: number,
  targetUserId?: number | null,
): Promise<{ before: number; after: number }> {
  if (!Number.isFinite(newExpiredTime) || newExpiredTime <= 0) {
    throw new Error(`非法 newExpiredTime=${newExpiredTime}`);
  }
  if (targetUserId) {
    return await updateTokenExpiredTimeInDb(tokenId, newExpiredTime);
  }
  const before = await getTokenById(tokenId, targetUserId);
  const beforeExp = Number(before.expired_time);

  // PUT 完整对象,只覆盖 expired_time
  await call(`/api/token/`, {
    method: 'PUT',
    body: JSON.stringify({ ...before, expired_time: newExpiredTime }),
  }, targetUserId);

  // 验证落地
  const after = await getTokenById(tokenId, targetUserId);
  const afterExp = Number(after.expired_time);
  if (afterExp !== newExpiredTime) {
    throw new Error(
      `NewAPI 端 expired_time 未生效 (期望 ${newExpiredTime},实际 ${afterExp})`,
    );
  }
  return { before: beforeExp, after: afterExp };
}

/** 调整 token USD 额度,用于续费卡叠加额度和失败回滚。 */
export async function addTokenQuotaUSD(
  tokenId: number,
  addUSD: number,
  targetUserId?: number | null,
): Promise<{ before: number; after: number }> {
  if (!Number.isFinite(addUSD) || addUSD === 0) {
    throw new Error(`非法 addUSD=${addUSD}`);
  }
  const before = await getTokenById(tokenId, targetUserId);
  const beforeQuota = Number(before.remain_quota || 0);
  const addQuota = Math.round(addUSD * QUOTA_PER_USD);
  if (targetUserId) {
    return await addTokenQuotaInDb(tokenId, addQuota);
  }
  const afterQuota = beforeQuota + addQuota;
  if (afterQuota < 0) {
    throw new Error(`额度调整后为负数 (before=${beforeQuota},add=${addQuota})`);
  }

  await call(`/api/token/`, {
    method: 'PUT',
    body: JSON.stringify({
      ...before,
      unlimited_quota: false,
      remain_quota: afterQuota,
    }),
  }, targetUserId);

  const after = await getTokenById(tokenId, targetUserId);
  const landed = Number(after.remain_quota || 0);
  if (landed !== afterQuota || after.unlimited_quota) {
    throw new Error(
      `NewAPI 端 quota 未生效 (期望 remain=${afterQuota},实际 remain=${landed},unlimited=${after.unlimited_quota})`,
    );
  }
  return { before: beforeQuota, after: landed };
}

/**
 * 端到端创建 token 并返回完整 sk-xxx key
 * 失败时尝试清理已创建的孤儿 token
 *
 * @param noExpire 若 true 则 NewAPI expired_time=-1 (永不过期),返回的 expiredAt 也为 -1。
 *                 daysValid 在 noExpire=true 时不影响 token 过期,但仍记录在 cards.plan_days 用于展示。
 */
export async function createTokenAndGetKey(
  name: string,
  daysValid: number,
  modelLimits: string,
  quotaUSD?: number,
  noExpire?: boolean,
  group?: string,
  targetUserId?: number | null,
): Promise<{ id: number; key: string; expiredAt: number }> {
  const expiredAt = noExpire ? -1 : Math.floor(Date.now() / 1000) + daysValid * 86400;
  // NewAPI 管理 API 要求 Authorization 登录用户与 New-Api-User 完全一致,
  // 不能直接用管理员 access token 冒充客户创建。这里先按默认管理员创建,
  // 拿到 key 后再把 tokens.user_id 迁移到目标客户,这样后续使用日志归客户账号。
  await createToken({ name, expired_time: expiredAt, model_limits: modelLimits, quotaUSD, group });

  // 重试找 id (默认 5 次 × 250ms = 最多等 1s)
  const id = await findTokenIdWithRetry(name);
  if (!id) {
    // 这是个严重的孤儿场景:NewAPI 已经创建了 token 但我们找不到。
    // 没法清理,只能告警,需要人工到 NewAPI 后台搜该 name 处理。
    throw new Error(`创建 token 后无法定位 id (name=${name}),请到 NewAPI 后台手动清理`);
  }

  try {
    const key = await getTokenKey(id);
    await transferTokenToNewApiUser(id, targetUserId);
    return { id, key, expiredAt };
  } catch (e) {
    // 拿不到 key,清理孤儿 token
    try { await deleteToken(id); } catch (delErr) {
      console.error(`[newapi] 清理孤儿 token ${id} 失败`, delErr);
    }
    throw e;
  }
}
