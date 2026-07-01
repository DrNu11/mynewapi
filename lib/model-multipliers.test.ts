import { describe, expect, it } from 'vitest';

import {
  buildModelMultiplierChanges,
  normalizeSurgeMultiplier,
  type StoredModelMultiplier,
} from './model-multipliers';

describe('model surge multipliers', () => {
  it('multiplies the saved base ratio without changing unrelated models', () => {
    const stored: StoredModelMultiplier[] = [{
      model: 'claude-opus-4-6',
      category: 'claude',
      base_ratio: 2.5,
      multiplier: 1,
      effective_ratio: 2.5,
      updated_at: 1,
    }];

    const result = buildModelMultiplierChanges({
      currentRatios: { 'claude-opus-4-6': 2.5, 'gpt-5.4': 1.4 },
      stored,
      models: ['claude-opus-4-6'],
      multiplier: 3,
    });

    expect(result.nextRatios).toEqual({
      'claude-opus-4-6': 7.5,
      'gpt-5.4': 1.4,
    });
    expect(result.settings[0]).toEqual(expect.objectContaining({
      model: 'claude-opus-4-6',
      base_ratio: 2.5,
      multiplier: 3,
      effective_ratio: 7.5,
    }));
  });

  it('restores the original ratio when the multiplier returns to one', () => {
    const stored: StoredModelMultiplier[] = [{
      model: 'gpt-5.4',
      category: 'gpt',
      base_ratio: 1.4,
      multiplier: 3,
      effective_ratio: 4.2,
      updated_at: 1,
    }];

    const result = buildModelMultiplierChanges({
      currentRatios: { 'gpt-5.4': 4.2 },
      stored,
      models: ['gpt-5.4'],
      multiplier: 1,
    });

    expect(result.nextRatios['gpt-5.4']).toBe(1.4);
    expect(result.settings[0].multiplier).toBe(1);
  });

  it('rejects fixed-price or unknown models with no ModelRatio entry', () => {
    expect(() => buildModelMultiplierChanges({
      currentRatios: { 'gpt-5.4': 1.4 },
      stored: [],
      models: ['gpt-image-2'],
      multiplier: 3,
    })).toThrow('不支持倍率计费');
  });

  it('accepts safe decimal multipliers and rejects dangerous values', () => {
    expect(normalizeSurgeMultiplier(2.345)).toBe(2.35);
    expect(() => normalizeSurgeMultiplier(0)).toThrow();
    expect(() => normalizeSurgeMultiplier(10.1)).toThrow();
  });
});
