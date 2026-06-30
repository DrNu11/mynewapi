import { describe, expect, it } from 'vitest';

import { mergeLiveCardExpiry } from './result-live-sync';

describe('mergeLiveCardExpiry', () => {
  it('replaces a cached finite expiry when the server makes the card permanent', () => {
    const cached = {
      api_key: 'sk-test',
      expires_at: 1_782_878_302,
    };

    expect(mergeLiveCardExpiry(cached, { expires_at: null })).toEqual({
      api_key: 'sk-test',
      expires_at: null,
    });
  });

  it('keeps the cached value when an older server response omits expiry', () => {
    const cached = {
      api_key: 'sk-test',
      expires_at: 1_782_878_302,
    };

    expect(mergeLiveCardExpiry(cached, {})).toBe(cached);
  });
});
