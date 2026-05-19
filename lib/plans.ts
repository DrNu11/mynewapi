export type PlanId = '1d' | '7d' | '30d';

export interface Plan {
  id: PlanId;
  days: number;
  label: string;
  description: string;
}

export const PLANS: Plan[] = [
  { id: '1d', days: 1, label: '1 天畅用', description: '适合体验,激活后 24 小时内不限量' },
  { id: '7d', days: 7, label: '7 天畅用', description: '一周高强度使用,性价比首选' },
  { id: '30d', days: 30, label: '30 天畅用', description: '整月不限量,长期工作流首选' },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p])
) as Record<PlanId, Plan>;

export function isPlanId(v: string): v is PlanId {
  return v === '1d' || v === '7d' || v === '30d';
}

/**
 * 解析任意 `<N>d` 格式的 plan id(如 '15d'、'60d'、'365d')。
 * 用于自定义天数:plan 字段存 `${days}d`,plan_days 存数字。
 *
 * @param v       plan id 字符串
 * @param maxDays 上限(默认 3650 = 10 年)
 * @returns       匹配返回 days,否则 null
 */
export function parseCustomDays(v: string, maxDays = 3650): number | null {
  const m = /^(\d{1,4})d$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > maxDays) return null;
  return n;
}

/**
 * 给任意 days 数生成 Plan 对象(用于自定义天数场景)。
 * 命名规则:1/7/30 走预设(label="N 天畅用"),其他显示"自定义 N 天"。
 */
export function makePlanFromDays(days: number): Plan {
  const preset = (PLAN_BY_ID as Record<string, Plan>)[`${days}d`];
  if (preset) return preset;
  return {
    id: `${days}d` as PlanId,
    days,
    label: `${days} 天畅用`,
    description: '自定义周期',
  };
}
