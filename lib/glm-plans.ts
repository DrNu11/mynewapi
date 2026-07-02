import type { PlanId } from './plans';

export const GLM_PLAN_IDS = ['1d', '7d', '30d'] as const satisfies readonly PlanId[];
export type GlmPlanId = (typeof GLM_PLAN_IDS)[number];

export const GLM_BASE_REQUEST_QUOTA = 500;
export const GLM_REVIEW_BONUS_REQUEST_QUOTA = 166;

export function isGlmPlanId(plan: string): plan is GlmPlanId {
  return (GLM_PLAN_IDS as readonly string[]).includes(plan);
}

export function getGlmBaseRequestQuota(plan: string): number | null {
  return isGlmPlanId(plan) ? GLM_BASE_REQUEST_QUOTA : null;
}

export function getGlmPlanName(plan: string): string {
  if (plan === '1d') return '日卡';
  if (plan === '7d') return '周卡';
  if (plan === '30d') return '月卡';
  return '套餐';
}
