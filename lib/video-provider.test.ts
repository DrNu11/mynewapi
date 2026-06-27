import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createVideoTask,
  getVideoProviderTargets,
  queryVideoTask,
} from './video-provider';

const originalEnv = {
  key: process.env.NEWAPI_VIDEO_API_KEY,
  base: process.env.NEWAPI_VIDEO_BASE_URL,
};

describe('NewAPI video provider', () => {
  beforeEach(() => {
    process.env.NEWAPI_VIDEO_API_KEY = 'sk-test-video-key';
    process.env.NEWAPI_VIDEO_BASE_URL = 'https://api.example.test/v1/';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEnv.key === undefined) delete process.env.NEWAPI_VIDEO_API_KEY;
    else process.env.NEWAPI_VIDEO_API_KEY = originalEnv.key;
    if (originalEnv.base === undefined) delete process.env.NEWAPI_VIDEO_BASE_URL;
    else process.env.NEWAPI_VIDEO_BASE_URL = originalEnv.base;
  });

  test('submits a Hailuo image-to-video task through NewAPI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'video-public-123',
        object: 'video',
        status: 'queued',
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createVideoTask({
      model: 'hailuo-2.3',
      prompt: 'A calm tracking shot',
      firstFrameImage: 'https://example.test/frame.jpg',
      duration: 6,
      resolution: '1080P',
      accountIndex: -1,
    });

    expect(result).toEqual({ taskId: 'video-public-123', accountIndex: -1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/video/generations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'MiniMax-Hailuo-2.3',
      prompt: 'A calm tracking shot',
      duration: 6,
      size: '1080P',
      metadata: {
        first_frame_image: 'https://example.test/frame.jpg',
      },
    });
  });

  test('maps a completed NewAPI task and extracts metadata.url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'video-public-123',
        status: 'completed',
        metadata: { url: 'https://cdn.example.test/video.mp4' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));

    await expect(queryVideoTask('video-public-123', -1)).resolves.toEqual({
      status: 'Success',
      fileId: null,
      downloadUrl: 'https://cdn.example.test/video.mp4',
      errorMessage: null,
    });
  });

  test('uses a stable provider-managed reservation target for NewAPI tasks', () => {
    expect(getVideoProviderTargets()).toEqual([
      { index: -1, quota: Number.MAX_SAFE_INTEGER },
    ]);
  });

  test('rejects an empty successful response instead of creating a phantom task', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ));

    await expect(createVideoTask({
      model: 'hailuo-2.3-fast',
      prompt: 'Move forward',
      firstFrameImage: 'data:image/png;base64,AA==',
      duration: 10,
      resolution: '768P',
      accountIndex: -1,
    })).rejects.toThrow('NewAPI 未返回视频任务 ID');
  });

  test('keeps a direct MiniMax task successful when file retrieval is temporarily unavailable', async () => {
    delete process.env.NEWAPI_VIDEO_API_KEY;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'Success',
        file_id: 'file-direct-123',
        base_resp: { status_code: 0 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        base_resp: { status_code: 1004, status_msg: 'temporary unavailable' },
      }), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(queryVideoTask('direct-task-123', 0)).resolves.toEqual({
      status: 'Success',
      fileId: 'file-direct-123',
      downloadUrl: null,
      errorMessage: null,
    });
  });
});
