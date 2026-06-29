import { describe, expect, it } from 'vitest';

import { validateRenewalCompatibility } from './renewal-policy';

describe('renewal compatibility', () => {
  it('allows GLM cards to renew with the same plan', () => {
    expect(
      validateRenewalCompatibility(
        { category: 'glm', plan: '7d' },
        { category: 'glm', plan: '7d' },
      ),
    ).toBeNull();
  });

  it('rejects GLM renewal cards with a different duration', () => {
    expect(
      validateRenewalCompatibility(
        { category: 'glm', plan: '7d' },
        { category: 'glm', plan: '30d' },
      ),
    ).toBe('续费卡必须与当前卡套餐一致，不支持不同套餐互相续费。');
  });

  it('keeps the existing same-category rule for non-GLM cards', () => {
    expect(
      validateRenewalCompatibility(
        { category: 'deepseek', plan: '1d' },
        { category: 'deepseek', plan: '7d' },
      ),
    ).toBeNull();
  });
});
