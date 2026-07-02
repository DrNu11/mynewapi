import { describe, expect, it } from 'vitest';

import {
  buildChoicesNullFallback,
  shouldInspectChoicesNullChatResponse,
} from '@/app/v1/[...path]/route';

describe('v1 chat choices:null fallback', () => {
  it('returns moderation error for choices:null with moderation field', () => {
    const fallback = buildChoicesNullFallback({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'deepseek-v4-pro',
      choices: null,
      moderation: {
        input: { code: 'content_filter' },
      },
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    });

    expect(fallback).toEqual({
      status: 400,
      hasModeration: true,
      body: {
        error: {
          message: 'Request was blocked by moderation.',
          type: 'moderation_blocked',
          code: 'content_filter',
        },
      },
    });
  });

  it('returns moderation error for choices:null with content_filter text', () => {
    const fallback = buildChoicesNullFallback({
      choices: null,
      detail: { reject_reason: 'openai_finish_reason=content_filter' },
    });

    expect(fallback?.status).toBe(400);
    expect(fallback?.hasModeration).toBe(true);
    expect(fallback?.body.error.type).toBe('moderation_blocked');
  });

  it('returns upstream format error for choices:null without moderation signal', () => {
    const fallback = buildChoicesNullFallback({
      id: 'chatcmpl-test',
      choices: null,
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    });

    expect(fallback).toEqual({
      status: 502,
      hasModeration: false,
      body: {
        error: {
          message: 'Upstream returned an invalid OpenAI-compatible response: choices is null.',
          type: 'upstream_format_error',
          code: 'invalid_upstream_choices',
        },
      },
    });
  });

  it('leaves normal choices array responses alone', () => {
    expect(buildChoicesNullFallback({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'OK' },
          finish_reason: 'stop',
        },
      ],
    })).toBeNull();
  });

  it('does not mis-handle completion_tokens=0 when choices is an array', () => {
    expect(buildChoicesNullFallback({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '' },
          finish_reason: 'content_filter',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    })).toBeNull();
  });

  it('only inspects non-stream JSON chat completions', () => {
    expect(shouldInspectChoicesNullChatResponse(['chat', 'completions'], false, 'application/json', false)).toBe(true);
    expect(shouldInspectChoicesNullChatResponse(['chat', 'completions'], true, 'application/json', false)).toBe(false);
    expect(shouldInspectChoicesNullChatResponse(['chat', 'completions'], false, 'text/event-stream', true)).toBe(false);
    expect(shouldInspectChoicesNullChatResponse(['models'], false, 'application/json', false)).toBe(false);
    expect(shouldInspectChoicesNullChatResponse(['responses'], false, 'application/json', false)).toBe(false);
  });
});
