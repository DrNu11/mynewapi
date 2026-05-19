// 客户端 fetch wrapper — 统一调 toplenged-ai 同源的 /api/* BFF 路由
//
// 用法:
//   const me = await api.get<UserSelfResp>("user/self");
//   await api.post("user/login", { username, password });
//
// 错误处理:
//   - HTTP 401/403 → 抛 UnauthorizedError(调用方决定是否跳 /login)
//   - 5xx → 抛 UpstreamError
//   - business error(success:false) → 抛 ApiError 带 message

export class ApiError extends Error {
  constructor(public message: string, public status: number, public payload?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Not authenticated") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

// NewAPI 用 cookie session + New-Api-User header 双重鉴权(anti-CSRF)
//   - cookie 提供真实身份(session.id,httpOnly,客户端无法读)
//   - New-Api-User header 是客户端声明的 user id,服务端校验必须 == session.id
//   - 攻击者即使骗用户带 cookie 发请求,因不知 user id 仍会被服务端拒绝
//
// 因此客户端必须缓存 user id。这里用 localStorage 保证刷新后仍可用(配合 cookie session)。

const USER_ID_KEY = "newapi_user_id";

function getApiUserId(): string | null {
  if (typeof window === "undefined") return null; // SSR / Next.js API route
  return window.localStorage.getItem(USER_ID_KEY);
}

export function setApiUserId(id: number | string | null) {
  if (typeof window === "undefined") return;
  if (id === null) window.localStorage.removeItem(USER_ID_KEY);
  else window.localStorage.setItem(USER_ID_KEY, String(id));
}

// NewAPI 的标准响应壳
export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data?: T;
};

type Options = Omit<RequestInit, "body" | "method"> & {
  query?: Record<string, string | number | boolean | undefined>;
};

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: Options = {}
): Promise<T> {
  // 规范化路径:去前导 /,去 api/ 前缀,去末尾 /(避免 Next.js 14 默认 trailingSlash:false 触发 308 重定向)
  // 容错:既支持 "user/self" / "/api/user/self" / "token/" 都能正确路由
  const cleanPath = path
    .replace(/^\/+/, "")
    .replace(/^api\//, "")
    .replace(/\/+$/, "");
  let url = `/api/${cleanPath}`;

  if (opts.query) {
    const qs = new URLSearchParams();
    Object.entries(opts.query).forEach(([k, v]) => {
      if (v !== undefined) qs.set(k, String(v));
    });
    const q = qs.toString();
    if (q) url += `?${q}`;
  }

  // 组装 headers,自动注入 New-Api-User(NewAPI anti-CSRF 双重鉴权要求)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const uid = getApiUserId();
  if (uid) headers["New-Api-User"] = uid;
  Object.assign(headers, opts.headers ?? {});

  const init: RequestInit = {
    method,
    credentials: "include", // 让浏览器带 session cookie
    headers,
    ...opts,
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const resp = await fetch(url, init);

  // 解析 body(可能不是 JSON,如 401 时)
  let payload: ApiEnvelope<T> | undefined;
  const ct = resp.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    payload = (await resp.json()) as ApiEnvelope<T>;
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new UnauthorizedError(payload?.message || resp.statusText);
  }
  if (!resp.ok) {
    throw new ApiError(payload?.message || resp.statusText, resp.status, payload);
  }
  if (payload && payload.success === false) {
    throw new ApiError(payload.message || "Request failed", resp.status, payload);
  }

  // NewAPI 响应是 { success, message, data },返回 data
  return payload?.data as T;
}

export const api = {
  get: <T = unknown>(path: string, opts?: Options) => request<T>("GET", path, undefined, opts),
  post: <T = unknown>(path: string, body?: unknown, opts?: Options) =>
    request<T>("POST", path, body, opts),
  put: <T = unknown>(path: string, body?: unknown, opts?: Options) =>
    request<T>("PUT", path, body, opts),
  patch: <T = unknown>(path: string, body?: unknown, opts?: Options) =>
    request<T>("PATCH", path, body, opts),
  delete: <T = unknown>(path: string, opts?: Options) => request<T>("DELETE", path, undefined, opts),
};

// =================================================
// 类型定义 — 对应 NewAPI 后端 model.User
// =================================================

export type UserSelf = {
  id: number;
  username: string;
  display_name: string;
  role: number;             // 1=common, 10=admin, 100=root
  status: number;           // 1=enabled
  group: string;
  email?: string;
  quota: number;            // 总额度(NewAPI 单位:500000 = $1)
  used_quota: number;
  request_count: number;
  aff_code?: string;
  inviter_id?: number;
};

export type UserStatus = {
  // NewAPI /api/status 返回的 SystemConfig
  system_name?: string;
  logo?: string;
  server_address?: string;
  email_verification?: boolean;
  github_oauth?: boolean;
  google_oauth?: boolean;
  password_login?: boolean;
  password_register?: boolean;
  register_enabled?: boolean;
  turnstile_check?: boolean;
  turnstile_site_key?: string;
  // ... 还有很多,按需添加
};

// NewAPI quota 单位转换:500000 = $1(默认 quota_per_unit)
export const QUOTA_PER_USD = 500000;
export const quotaToUSD = (q: number) => q / QUOTA_PER_USD;

// =================================================
// Token (sk-xxx) 类型
// =================================================

export type Token = {
  id: number;
  user_id: number;
  key: string;              // masked!列表接口返回 4***********4 格式
  status: number;           // 1=active, 2=disabled, 3=expired
  name: string;
  created_time: number;     // unix sec
  accessed_time: number;
  expired_time: number;     // -1 = never
  remain_quota: number;
  unlimited_quota: boolean;
  used_quota: number;
  model_limits_enabled: boolean;
  model_limits: string;
  allow_ips: string | null;
  group: string;
  cross_group_retry: boolean;
};

export type PageInfo<T> = {
  page: number;
  page_size: number;
  total: number;
  items: T[];
};

// =================================================
// Log (model.Log) 类型 — 对应 NewAPI /api/log/self
// =================================================

export const LogType = {
  Unknown: 0,
  Topup: 1,
  Consume: 2,
  Manage: 3,
  System: 4,
  Error: 5,
  Refund: 6,
} as const;

export type LogEntry = {
  id: number;
  user_id: number;
  created_at: number;          // unix seconds(注意:不是 ms)
  type: number;                // 见 LogType
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;               // 本次消耗的 quota(NewAPI 单位,500000 = $1)
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;            // 秒
  is_stream: boolean;
  channel: number;
  channel_name?: string;
  token_id: number;
  group: string;
  ip: string;
  request_id?: string;
  upstream_request_id?: string;
  other: string;               // JSON 字符串,模型计费细节
};

// /api/log/self/stat 响应 —— 注意 rpm/tpm 是最近 60 秒窗口!
// quota 是 [start_timestamp, end_timestamp] 区间总消耗
export type LogStat = {
  quota: number;
  rpm: number;
  tpm: number;
};
