export interface RenewalCardIdentity {
  category: string | null;
  plan: string;
}

const SAME_PLAN_REQUIRED = '续费卡必须与当前卡套餐一致，不支持不同套餐互相续费。';

/**
 * GLM 续费必须同套餐；其他分类保留现有的同分类跨时长续费规则。
 * 分类一致性由续费接口在调用本函数前校验。
 */
export function validateRenewalCompatibility(
  original: RenewalCardIdentity,
  renewal: RenewalCardIdentity,
): string | null {
  if (original.category === 'glm' && renewal.plan !== original.plan) {
    return SAME_PLAN_REQUIRED;
  }
  return null;
}
