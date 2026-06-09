export const MINIMAX_VIDEO_MODELS = ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast'] as const;
export const MINIMAX_VIDEO_DURATIONS = [6, 10] as const;
export const MINIMAX_VIDEO_RESOLUTIONS = ['768P', '1080P'] as const;

export type MiniMaxVideoModel = (typeof MINIMAX_VIDEO_MODELS)[number];
export type MiniMaxVideoDuration = (typeof MINIMAX_VIDEO_DURATIONS)[number];
export type MiniMaxVideoResolution = (typeof MINIMAX_VIDEO_RESOLUTIONS)[number];

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

function apiKey(): string {
  const key = process.env.MINIMAX_API_KEY || '';
  if (!key) throw new Error('MINIMAX_API_KEY 未配置');
  return key;
}

async function minimaxFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
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
    throw new Error(body?.base_resp?.status_msg || body?.message || `MiniMax HTTP ${res.status}`);
  }
  const statusCode = body?.base_resp?.status_code;
  if (typeof statusCode === 'number' && statusCode !== 0) {
    throw new Error(body?.base_resp?.status_msg || `MiniMax status_code ${statusCode}`);
  }
  return body as T;
}

export function isMiniMaxVideoModel(v: unknown): v is MiniMaxVideoModel {
  return MINIMAX_VIDEO_MODELS.includes(v as MiniMaxVideoModel);
}

export function isMiniMaxVideoDuration(v: unknown): v is MiniMaxVideoDuration {
  return MINIMAX_VIDEO_DURATIONS.includes(Number(v) as MiniMaxVideoDuration);
}

export function isMiniMaxVideoResolution(v: unknown): v is MiniMaxVideoResolution {
  return MINIMAX_VIDEO_RESOLUTIONS.includes(v as MiniMaxVideoResolution);
}

export async function createMiniMaxVideoTask(args: {
  model: MiniMaxVideoModel;
  prompt: string;
  firstFrameImage: string;
  duration: MiniMaxVideoDuration;
  resolution: MiniMaxVideoResolution;
}): Promise<{ taskId: string }> {
  const body = await minimaxFetch<CreateVideoResp>('/v1/video_generation', {
    method: 'POST',
    body: JSON.stringify({
      model: args.model,
      prompt: args.prompt,
      first_frame_image: args.firstFrameImage,
      duration: args.duration,
      resolution: args.resolution,
    }),
  });
  if (!body.task_id) throw new Error('MiniMax 未返回 task_id');
  return { taskId: body.task_id };
}

export async function queryMiniMaxVideoTask(taskId: string): Promise<{
  status: string;
  fileId: string | null;
}> {
  const q = new URLSearchParams({ task_id: taskId });
  const body = await minimaxFetch<QueryVideoResp>(`/v1/query/video_generation?${q.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return {
    status: body.status || 'Unknown',
    fileId: body.file_id || null,
  };
}

export async function retrieveMiniMaxFile(fileId: string): Promise<{ downloadUrl: string }> {
  const q = new URLSearchParams({ file_id: fileId });
  const body = await minimaxFetch<RetrieveFileResp>(`/v1/files/retrieve?${q.toString()}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const downloadUrl = body.file?.download_url;
  if (!downloadUrl) throw new Error('MiniMax 未返回下载地址');
  return { downloadUrl };
}
