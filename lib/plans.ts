export type PlanId = '0.5d' | '1d' | '7d' | '30d' | '30d_light' | '30d-unlimited';

export interface Plan {
  id: PlanId;
  days: number;
  label: string;
  description: string;
  /** 该套餐对应的每小时请求数限制(0 = 不限速,覆盖 category.defaultRPH) */
  rphOverride?: number;
  /** 内部套餐:不在公开主页 PLANS 列表展示,只在 admin 后台可见 */
  internal?: boolean;
  /** 该套餐 token 的 USD 额度;不设则 unlimited_quota=true(吃 root 池) */
  quotaUSD?: number;
  /** 永不过期(NewAPI expired_time=-1, cards.expires_at=NULL);只受 quotaUSD 约束 */
  noExpire?: boolean;
  /** NewAPI 渠道分组覆盖;不设则 token group='default'。例如 'pro' 让 token 只走 pro 组里的高优先渠道 */
  newapiGroup?: string;
  /** 滚动窗口请求次数限制(仅轻度月卡等套餐使用) */
  requestLimits?: {
    rolling24h: number;
    rolling7d: number;
    lifetime: number;
  };
}

export const PLANS: Plan[] = [
  { id: '0.5d', days: 0.5, label: '12 小时体验', description: '半天体验,激活后 12 小时内不限量' },
  { id: '1d', days: 1, label: '1 天畅用', description: '适合体验,激活后 24 小时内不限量' },
  { id: '7d', days: 7, label: '7 天高速', description: '一周高强度使用,性价比首选' },
  { id: '30d', days: 30, label: '30 天高速', description: '整月不限量,长期工作流首选' },
  {
    id: '30d_light',
    days: 30,
    label: '轻度月卡',
    description: 'DeepSeek 轻度月卡,30 天有效,每小时 500 / 24h 2000 / 7d 10000 / 总量 40000 次请求',
    requestLimits: { rolling24h: 2000, rolling7d: 10000, lifetime: 40000 },
  },
  {
    id: '30d-unlimited',
    days: 30,
    label: '尊享套餐 ($2000 额度,无限速,不过期)',
    description: '不限每小时次数,$2000 额度跑满为止,不设到期时间。仅 GPT 套餐适用',
    rphOverride: 0,
    quotaUSD: 2000,
    noExpire: true,
    internal: true,
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p])
) as Record<PlanId, Plan>;

export function isPlanId(v: string): v is PlanId {
  return v === '0.5d' || v === '1d' || v === '7d' || v === '30d' || v === '30d_light' || v === '30d-unlimited';
}

/**
 * 自定义天数最小粒度:0.04 天 ≈ 1 小时。
 * 纯 TS 浮点运算变动不超过 1e-9,不需额外 epsilon。
 */
export const MIN_CUSTOM_DAYS = 0.04;

/**
 * 解析任意 `<N>d` 格式的 plan id(如 '15d'、'0.5d'、'365d')。
 * 用于自定义天数:plan 字段存 `${days}d`,plan_days 存数字(可小数)。
 *
 * @param v       plan id 字符串
 * @param maxDays 上限(默认 3650 = 10 年)
 * @returns       匹配返回 days,否则 null
 */
export function parseCustomDays(v: string, maxDays = 3650): number | null {
  const m = /^(\d{1,4}(?:\.\d{1,4})?)d$/.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < MIN_CUSTOM_DAYS || n > maxDays) return null;
  return n;
}

/**
 * 把天数转成人读友好的中文标签。
 *   0.5  → "12 小时"
 *   0.25 → "6 小时"
 *   1    → "1 天"
 *   2.5  → "2 天 12 小时"
 */
export function formatDaysCN(days: number): string {
  if (days <= 0) return '0 天';
  if (days < 1) {
    const hours = Math.round(days * 24 * 100) / 100;
    return `${hours} 小时`;
  }
  const whole = Math.floor(days);
  const frac = days - whole;
  if (frac === 0) return `${whole} 天`;
  const hours = Math.round(frac * 24 * 100) / 100;
  return `${whole} 天 ${hours} 小时`;
}

/**
 * 给任意 days 数生成 Plan 对象(用于自定义天数场景)。
 * 命名规则:0.5/1/7/30 走预设,其他按 formatDaysCN 生成人读标签。
 */
export function makePlanFromDays(days: number): Plan {
  const preset = (PLAN_BY_ID as Record<string, Plan>)[`${days}d`];
  if (preset) return preset;
  return {
    id: `${days}d` as PlanId,
    days,
    label: `${formatDaysCN(days)}畅用`,
    description: '自定义周期',
  };
}
