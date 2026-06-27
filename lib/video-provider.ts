import {
  createHailuoVideoTask,
  getAccountsTotalQuota,
  HAILUO_ACCOUNTS,
  hailoModelToApi,
  queryHailuoVideoTask,
  retrieveHailuoFile,
  type HailuoDuration,
  type HailuoModel,
  type HailuoResolution,
} from '@/lib/minimax-video';

const DEFAULT_TIMEOUT_MS = 30_000;
const NEWAPI_PROVIDER_ACCOUNT_INDEX = -1;

export interface VideoProviderTarget {
  index: number;
  quota: number;
}

export interface CreateVideoTaskInput {
  model: HailuoModel;
  prompt: string;
  firstFrameImage: string;
  duration: HailuoDuration;
  resolution: HailuoResolution;
  accountIndex: number;
}

export interface VideoProviderTask {
  status: string;
  fileId: string | null;
  downloadUrl: string | null;
  errorMessage: string | null;
}

interface NewApiVideoResponse {
  id?: string;
  task_id?: string;
  status?: string;
  url?: string;
  metadata?: {
    url?: string;
    file_id?: string;
  };
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
}

export function isNewApiVideoConfigured(): boolean {
  return Boolean((process.env.NEWAPI_VIDEO_API_KEY || '').trim());
}

export function getVideoProviderTargets(): VideoProviderTarget[] {
  if (isNewApiVideoConfigured()) {
    return [{ index: NEWAPI_PROVIDER_ACCOUNT_INDEX, quota: Number.MAX_SAFE_INTEGER }];
  }
  return HAILUO_ACCOUNTS.map(({ index, quota }) => ({ index, quota }));
}

export function getVideoProviderTotalQuota(): number | null {
  return isNewApiVideoConfigured() ? null : getAccountsTotalQuota();
}

export function isNewApiVideoTask(accountIndex: number): boolean {
  return accountIndex === NEWAPI_PROVIDER_ACCOUNT_INDEX;
}

function newApiBaseUrl(): string {
  const raw = (
    process.env.NEWAPI_VIDEO_BASE_URL ||
    process.env.NEWAPI_INTERNAL_URL ||
    process.env.NEWAPI_BASE_URL ||
    'https://api.nassaapi.xyz'
  ).trim().replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

function responseMessage(body: NewApiVideoResponse | null, status: number): string {
  return body?.error?.message || body?.message || `NewAPI 视频接口返回 HTTP ${status}`;
}

async function newApiVideoFetch(path: string, init?: RequestInit): Promise<NewApiVideoResponse> {
  const apiKey = (process.env.NEWAPI_VIDEO_API_KEY || '').trim();
  if (!apiKey) throw new Error('未配置 NEWAPI_VIDEO_API_KEY');

  const controller = new AbortController();
  const timeoutMs = Number(process.env.NEWAPI_VIDEO_HTTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${newApiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const raw = await response.text();
    let body: NewApiVideoResponse | null = null;
    try {
      body = raw ? JSON.parse(raw) as NewApiVideoResponse : null;
    } catch {
      body = null;
    }

    if (!response.ok || !body) {
      const error = new Error(responseMessage(body, response.status)) as Error & { httpStatus?: number };
      error.httpStatus = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function mapNewApiStatus(status: string | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'queued':
      return 'Submitted';
    case 'in_progress':
    case 'processing':
      return 'Processing';
    case 'completed':
    case 'succeeded':
    case 'success':
      return 'Success';
    case 'failed':
    case 'cancelled':
    case 'canceled':
      return 'Failed';
    default:
      return status || 'Unknown';
  }
}

export async function createVideoTask(args: CreateVideoTaskInput): Promise<{
  taskId: string;
  accountIndex: number;
}> {
  if (!isNewApiVideoTask(args.accountIndex)) {
    return createHailuoVideoTask(args);
  }

  const body = await newApiVideoFetch('/video/generations', {
    method: 'POST',
    body: JSON.stringify({
      model: hailoModelToApi(args.model),
      prompt: args.prompt,
      duration: args.duration,
      size: args.resolution,
      metadata: {
        first_frame_image: args.firstFrameImage,
      },
    }),
  });
  const taskId = body.id || body.task_id;
  if (!taskId) throw new Error('NewAPI 未返回视频任务 ID');
  return { taskId, accountIndex: args.accountIndex };
}

export async function queryVideoTask(taskId: string, accountIndex: number): Promise<VideoProviderTask> {
  if (isNewApiVideoTask(accountIndex)) {
    const body = await newApiVideoFetch(`/video/generations/${encodeURIComponent(taskId)}`, {
      method: 'GET',
    });
    return {
      status: mapNewApiStatus(body.status),
      fileId: body.metadata?.file_id || null,
      downloadUrl: body.metadata?.url || body.url || null,
      errorMessage: body.error?.message || null,
    };
  }

  const remote = await queryHailuoVideoTask(taskId, accountIndex);
  let downloadUrl: string | null = null;
  if (remote.fileId && remote.status.toLowerCase().includes('success')) {
    try {
      const file = await retrieveHailuoFile(remote.fileId, accountIndex);
      downloadUrl = file.downloadUrl;
    } catch {
      // Keep the successful task state; the reconciler will retry the file lookup.
    }
  }
  return {
    status: remote.status,
    fileId: remote.fileId,
    downloadUrl,
    errorMessage: null,
  };
}
