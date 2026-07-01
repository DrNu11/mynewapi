import { afterEach, describe, expect, it } from 'vitest';

import { CATEGORIES, modelsForCategory } from './categories';

const previousClaudeModels = process.env.MODELS_CLAUDE;

afterEach(() => {
  if (previousClaudeModels === undefined) {
    delete process.env.MODELS_CLAUDE;
  } else {
    process.env.MODELS_CLAUDE = previousClaudeModels;
  }
});

describe('Claude category', () => {
  it('grants Claude users access to Opus 4.6 and advertises it on the homepage', () => {
    delete process.env.MODELS_CLAUDE;

    expect(modelsForCategory('claude')).toContain('claude-opus-4-6');
    expect(CATEGORIES.claude.description).toContain('Opus 4.6');
  });
});
