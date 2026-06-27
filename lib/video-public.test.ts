import { describe, expect, test } from 'vitest';

import { toPublicVideoTask } from './video-public';
import type { VideoTask } from './db';

describe('toPublicVideoTask', () => {
  test('keeps workspace fields and removes credentials and internal bookkeeping', () => {
    const task: VideoTask = {
      id: 7,
      task_id: 'video-123',
      card_id: 9,
      sk_key: 'sk-secret-value',
      model: 'hailuo-2.3',
      prompt: 'Slow camera push',
      duration: 6,
      resolution: '1080P',
      status: 'Success',
      file_id: 'file-123',
      download_url: 'https://cdn.example.test/video.mp4',
      error_message: null,
      account_index: 174,
      quota_source: 'base',
      reservation_id: 4,
      operation_id: 'op-123',
      last_query_error: null,
      query_error_count: 0,
      last_queried_at: 100,
      created_at: 100,
      updated_at: 120,
    };

    const publicTask = toPublicVideoTask(task);

    expect(publicTask).toEqual({
      task_id: 'video-123',
      model: 'hailuo-2.3',
      prompt: 'Slow camera push',
      duration: 6,
      resolution: '1080P',
      status: 'Success',
      download_url: 'https://cdn.example.test/video.mp4',
      error_message: null,
      created_at: 100,
      updated_at: 120,
    });
    expect(JSON.stringify(publicTask)).not.toContain('sk-secret-value');
    expect(publicTask).not.toHaveProperty('card_id');
    expect(publicTask).not.toHaveProperty('account_index');
  });
});
