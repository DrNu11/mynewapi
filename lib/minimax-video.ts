export const HAILUO_MODELS = ['hailuo-2.3', 'hailuo-2.3-fast'] as const;
export const HAILUO_DURATIONS = [6, 10] as const;
export const HAILUO_RESOLUTIONS = ['768P', '1080P'] as const;

export type HailuoModel = (typeof HAILUO_MODELS)[number];
export type HailuoDuration = (typeof HAILUO_DURATIONS)[number];
export type HailuoResolution = (typeof HAILUO_RESOLUTIONS)[number];

/** 展示名 → MiniMax API 模型名映射 */
const HAILUO_TO_API: Record<HailuoModel, string> = {
  'hailuo-2.3': 'MiniMax-Hailuo-2.3',
  'hailuo-2.3-fast': 'MiniMax-Hailuo-2.3-Fast',
};

/** 展示标签 */
export const HAILUO_MODEL_LABELS: Record<HailuoModel, string> = {
  'hailuo-2.3': '海螺 2.3',
  'hailuo-2.3-fast': '海螺 2.3 Fast',
};

export function hailoModelToApi(model: HailuoModel): string {
  return HAILUO_TO_API[model];
}

// ---- 多账号池 ----

export interface HailuoAccount {
  index: number;
  key: string;
  quota: number; // 5 小时配额
}

const DEFAULT_QUOTA = 5;

function parseAccounts(): HailuoAccount[] {
  const accounts: HailuoAccount[] = [];
  // 主账号
  const k1 = (process.env.MINIMAX_API_KEY || '').trim();
  if (k1) {
    accounts.push({
      index: 0,
      key: k1,
      quota: parseInt(process.env.MINIMAX_KEY_QUOTA || '', 10) || DEFAULT_QUOTA,
    });
  }
  // 额外账号: MINIMAX_API_KEY_2, MINIMAX_API_KEY_3, ...
  for (let i = 2; i <= 9; i++) {
    const key = (process.env[`MINIMAX_API_KEY_${i}`] || '').trim();
    if (!key) break;
    const quotaEnv = process.env[`MINIMAX_KEY_${i}_QUOTA`];
    accounts.push({
      index: i - 1,
      key,
      quota: parseInt(quotaEnv || '', 10) || DEFAULT_QUOTA,
    });
  }
  return accounts;
}

export const HAILUO_ACCOUNTS = parseAccounts();

export function getAccount(index: number): HailuoAccount | undefined {
  return HAILUO_ACCOUNTS.find((a) => a.index === index);
}

export function getAccountsTotalQuota(): number {
  return HAILUO_ACCOUNTS.reduce((s, a) => s + a.quota, 0);
}

// ---- MiniMax HTTP client (internal) ----

interface MiniMaxBaseResp {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

interface CreateVideoResp extends MiniMaxBaseResp {
  task_id?: string;
}

interface QueryVideoResp extends MiniMaxBaseResp {
  task_id?: string;
  status?: string;
  file_id?: string;
}

interface RetrieveFileResp extends MiniMaxBaseResp {
  file?: {
    file_id?: string;
    download_url?: string;
  };
}

function apiBase(): string {
  return (process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com').replace(/\/$/, '');
}

async function minimaxFetch<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const timeoutMs = Number(process.env.MINIMAX_HTTP_TIMEOUT_MS || 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const msg = body?.base_resp?.status_msg || body?.message || `海螺 HTTP ${res.status}`;
      const err = new Error(msg) as any;
      err.httpStatus = res.status;
      throw err;
    }
    const statusCode = body?.base_resp?.status_code;
    if (typeof statusCode === 'number' && statusCode !== 0) {
      const err = new Error(body?.base_resp?.status_msg || `海螺 status_code ${statusCode}`) as any;
      err.apiStatusCode = statusCode;
      throw err;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function isHailuoModel(v: unknown): v is HailuoModel {
  return HAILUO_MODELS.includes(v as HailuoModel);
}

export function isHailuoDuration(v: unknown): v is HailuoDuration {
  return HAILUO_DURATIONS.includes(Number(v) as HailuoDuration);
}

export function isHailuoResolution(v: unknown): v is HailuoResolution {
  return HAILUO_RESOLUTIONS.includes(v as HailuoResolution);
}

export interface CreateTaskResult {
  taskId: string;
  accountIndex: number;
}

/**
 * 创建视频任务，按账号顺序尝试。
 * 遇到限流错误自动切换到下一个账号。
 */
export async function createHailuoVideoTask(args: {
  model: HailuoModel;
  prompt: string;
  firstFrameImage: string;
  duration: HailuoDuration;
  resolution: HailuoResolution;
  /** 强制使用指定账号 */
  accountIndex?: number;
}): Promise<CreateTaskResult> {
  if (HAILUO_ACCOUNTS.length === 0) throw new Error('未配置海螺 API Key');

  const accounts = args.accountIndex !== undefined
    ? [getAccount(args.accountIndex)].filter(Boolean) as HailuoAccount[]
    : HAILUO_ACCOUNTS;

  const errors: string[] = [];

  for (const account of accounts) {
    try {
      const body = await minimaxFetch<CreateVideoResp>('/v1/video_generation', account.key, {
        method: 'POST',
        body: JSON.stringify({
          model: hailoModelToApi(args.model),
          prompt: args.prompt,
          first_frame_image: args.firstFrameImage,
          duration: args.duration,
          resolution: args.resolution,
        }),
      });
      if (!body.task_id) throw new Error('海螺未返回 task_id');
      return { taskId: body.task_id, accountIndex: account.index };
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      errors.push(`账号${account.index + 1}: ${msg}`);
      // 指定账号时直接抛原始错误,不内部循环
      if (args.accountIndex !== undefined) throw e;
      // 限流/配额错误 → 尝试下一个账号
      if (
        e?.httpStatus === 429 ||
        e?.apiStatusCode === 1004 || // MiniMax rate limit code
        msg.includes('rate') ||
        msg.includes('Rate') ||
        msg.includes('limit') ||
        msg.includes('quota') ||
        msg.includes('Quota') ||
        msg.includes('exceeded') ||
        msg.includes('throttle')
      ) {
        continue;
      }
      // 非限流错误直接抛
      throw e;
    }
  }

  throw new Error(`所有海螺账号均不可用: ${errors.join('; ')}`);
}

export async function queryHailuoVideoTask(taskId: string, accountIndex: number): Promise<{
  status: string;
  fileId: string | null;
}> {
  const account = getAccount(accountIndex);
  if (!account) throw new Error(`海螺账号 ${accountIndex} 不存在`);
  const q = new URLSearchParams({ task_id: taskId });
  const body = await minimaxFetch<QueryVideoResp>(`/v1/query/video_generation?${q.toString()}`, account.key, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    status: body.status || 'Unknown',
    fileId: body.file_id || null,
  };
}

export async function retrieveHailuoFile(fileId: string, accountIndex: number): Promise<{ downloadUrl: string }> {
  const account = getAccount(accountIndex);
  if (!account) throw new Error(`海螺账号 ${accountIndex} 不存在`);
  const q = new URLSearchParams({ file_id: fileId });
  const body = await minimaxFetch<RetrieveFileResp>(`/v1/files/retrieve?${q.toString()}`, account.key, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const downloadUrl = body.file?.download_url;
  if (!downloadUrl) throw new Error('海螺未返回下载地址');
  return { downloadUrl };
}
