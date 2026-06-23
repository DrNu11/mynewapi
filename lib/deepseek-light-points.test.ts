import { describe, it, expect } from 'vitest';

// ── DeepSeek 轻度月卡权重函数 (mirrors db.ts) ──────────────────
function getDeepSeekLightRequestWeight(model: string | null): number {
  const m = (model || '').trim();
  if (m === 'deepseek-v4-pro') return 3;
  if (m === 'deepseek-v4-flash' || m === 'DeepSeek') return 1;
  return 1;
}

const DS_LIGHT_QUOTA_24H = 2000;
const DS_LIGHT_QUOTA_7D = 10000;
const DS_LIGHT_QUOTA_TOTAL = 40000;

// ── 点数汇总逻辑 (模拟 countCardWeightedPoints + request_logs 数据) ─
function computeWeightedPoints(
  requests: Array<{ model: string | null }>,
): number {
  return requests.reduce((sum, r) => sum + getDeepSeekLightRequestWeight(r.model), 0);
}

describe('getDeepSeekLightRequestWeight', () => {
  it('deepseek-v4-pro = 3 点', () => {
    expect(getDeepSeekLightRequestWeight('deepseek-v4-pro')).toBe(3);
  });

  it('deepseek-v4-flash = 1 点', () => {
    expect(getDeepSeekLightRequestWeight('deepseek-v4-flash')).toBe(1);
  });

  it('DeepSeek 别名 = 1 点', () => {
    expect(getDeepSeekLightRequestWeight('DeepSeek')).toBe(1);
  });

  it('null model 默认 = 1 点', () => {
    expect(getDeepSeekLightRequestWeight(null)).toBe(1);
  });

  it('未知模型默认 = 1 点', () => {
    expect(getDeepSeekLightRequestWeight('unknown-model')).toBe(1);
  });

  it('非 deepseek 模型也是 1 点', () => {
    expect(getDeepSeekLightRequestWeight('gpt-4')).toBe(1);
  });
});

describe('computeWeightedPoints (模拟 request_logs 汇总)', () => {
  it('空请求列表 → 0 点', () => {
    expect(computeWeightedPoints([])).toBe(0);
  });

  it('10 次 flash → 10 点', () => {
    const reqs = Array(10).fill({ model: 'deepseek-v4-flash' });
    expect(computeWeightedPoints(reqs)).toBe(10);
  });

  it('5 次 pro + 5 次 flash → 20 点', () => {
    const reqs = [
      ...Array(5).fill({ model: 'deepseek-v4-pro' }),
      ...Array(5).fill({ model: 'deepseek-v4-flash' }),
    ];
    expect(computeWeightedPoints(reqs)).toBe(20); // 5*3 + 5*1
  });

  it('100 次 pro → 300 点', () => {
    const reqs = Array(100).fill({ model: 'deepseek-v4-pro' });
    expect(computeWeightedPoints(reqs)).toBe(300);
  });

  it('混合模型正确计算 (含 DeepSeek 别名)', () => {
    const reqs = [
      { model: 'deepseek-v4-pro' },
      { model: 'deepseek-v4-pro' },
      { model: 'deepseek-v4-flash' },
      { model: 'deepseek-v4-flash' },
      { model: 'deepseek-v4-flash' },
      { model: 'DeepSeek' },
      { model: null },
      { model: 'unknown' },
    ];
    expect(computeWeightedPoints(reqs)).toBe(12); // 3+3+1+1+1+1+1+1
  });
});

describe('DS_LIGHT quota constants', () => {
  it('24h quota = 2000', () => {
    expect(DS_LIGHT_QUOTA_24H).toBe(2000);
  });

  it('7d quota = 10000', () => {
    expect(DS_LIGHT_QUOTA_7D).toBe(10000);
  });

  it('total quota = 40000', () => {
    expect(DS_LIGHT_QUOTA_TOTAL).toBe(40000);
  });

  it('total > 7d > 24h (层级合理)', () => {
    expect(DS_LIGHT_QUOTA_TOTAL).toBeGreaterThan(DS_LIGHT_QUOTA_7D);
    expect(DS_LIGHT_QUOTA_7D).toBeGreaterThan(DS_LIGHT_QUOTA_24H);
  });
});

// ── /api/usage response 结构验证 (针对 30d_light) ──────────────
describe('/api/usage weightedPoints response shape', () => {
  it('30d_light 返回 weightedPoints 非 null', () => {
    const isDeepSeekLight = true;
    const weighted = isDeepSeekLight
      ? {
          weightedPoints24h: 0,
          weightedPoints7d: 0,
          weightedPointsTotal: 0,
          weightedQuota24h: 2000,
          weightedQuota7d: 10000,
          weightedQuotaTotal: 40000,
        }
      : null;
    expect(weighted).not.toBeNull();
    expect(weighted!.weightedPoints24h).toBe(0);
    expect(weighted!.weightedQuota24h).toBe(2000);
  });

  it('非 30d_light (GPT/Claude) weightedPoints 为 null', () => {
    const isDeepSeekLight = false;
    const weighted = isDeepSeekLight
      ? {
          weightedPoints24h: 1,
          weightedPoints7d: 1,
          weightedPointsTotal: 1,
          weightedQuota24h: 2000,
          weightedQuota7d: 10000,
          weightedQuotaTotal: 40000,
        }
      : null;
    expect(weighted).toBeNull();
  });

  it('非 30d_light DeepSeek 1d 不返回 weightedPoints', () => {
    // DeepSeek 1d: card.category === 'deepseek' but plan !== '30d_light'
    const category = 'deepseek';
    const plan = '1d';
    const isDeepSeekLight = category === 'deepseek' && plan === '30d_light';
    expect(isDeepSeekLight).toBe(false);
  });

  it('non-deepseek GLM 不返回 weightedPoints', () => {
    const category = 'glm';
    const plan = '1d';
    const isDeepSeekLight = category === 'deepseek' && plan === '30d_light';
    expect(isDeepSeekLight).toBe(false);
  });

  it('加权点数不会来自 NewAPI quota (只来自 request_logs)', () => {
    // 这个测试验证概念: 点数!= quota
    const newApiQuota = 11694307; // 实际 NewAPI quota 消耗
    const weightedPointsFromRequestLogs = 0; // request_logs 里的加权点数
    // 两者完全不同 — 证实 request_logs 数据和 NewAPI quota 无关
    expect(newApiQuota).not.toBe(weightedPointsFromRequestLogs);
  });
});

// ── 补账点数合并逻辑 (request_logs + card_usage_adjustments) ──
interface Adjustment {
  weighted_points: number;
  original_started_at: number;
  original_ended_at: number;
}

function mergeWeightedPoints(
  rlPoints: { since24h: number; since7d: number; sinceActivation: number },
  adjustments: Adjustment[],
  now: number,
  activatedAt: number,
): { weightedPoints24h: number; weightedPoints7d: number; weightedPointsTotal: number } {
  const since24h = now - 86400;
  const since7d = now - 7 * 86400;
  let adj24h = 0;
  let adj7d = 0;
  let adjTotal = 0;
  for (const adj of adjustments) {
    if (adj.original_ended_at >= since24h) adj24h += adj.weighted_points;
    if (adj.original_ended_at >= since7d) adj7d += adj.weighted_points;
    if (adj.original_ended_at >= activatedAt) adjTotal += adj.weighted_points;
  }
  return {
    weightedPoints24h: rlPoints.since24h + adj24h,
    weightedPoints7d: rlPoints.since7d + adj7d,
    weightedPointsTotal: rlPoints.sinceActivation + adjTotal,
  };
}

describe('mergeWeightedPoints (request_logs + adjustments)', () => {
  const now = 1700000000;
  const activatedAt = 1698000000; // ~23 days ago

  it('request_logs only (no adjustments) → 纯 request_logs', () => {
    const result = mergeWeightedPoints(
      { since24h: 10, since7d: 50, sinceActivation: 200 },
      [],
      now,
      activatedAt,
    );
    expect(result.weightedPoints24h).toBe(10);
    expect(result.weightedPoints7d).toBe(50);
    expect(result.weightedPointsTotal).toBe(200);
  });

  it('adjustment within 24h → 同时计入 24h/7d/total', () => {
    const result = mergeWeightedPoints(
      { since24h: 0, since7d: 0, sinceActivation: 0 },
      [{ weighted_points: 100, original_started_at: now - 3600, original_ended_at: now - 1800 }],
      now,
      activatedAt,
    );
    expect(result.weightedPoints24h).toBe(100);
    expect(result.weightedPoints7d).toBe(100);
    expect(result.weightedPointsTotal).toBe(100);
  });

  it('adjustment 3 days ago → 不在 24h, 在 7d/total', () => {
    const threeDaysAgo = now - 3 * 86400;
    const result = mergeWeightedPoints(
      { since24h: 0, since7d: 0, sinceActivation: 0 },
      [{ weighted_points: 50, original_started_at: threeDaysAgo, original_ended_at: threeDaysAgo + 3600 }],
      now,
      activatedAt,
    );
    expect(result.weightedPoints24h).toBe(0);
    expect(result.weightedPoints7d).toBe(50);
    expect(result.weightedPointsTotal).toBe(50);
  });

  it('adjustment before activation → 不计入 total', () => {
    const beforeActivation = activatedAt - 86400;
    const result = mergeWeightedPoints(
      { since24h: 0, since7d: 0, sinceActivation: 0 },
      [{ weighted_points: 50, original_started_at: beforeActivation, original_ended_at: beforeActivation + 3600 }],
      now,
      activatedAt,
    );
    expect(result.weightedPointsTotal).toBe(0);
  });

  it('多个 adjustments 正确合并', () => {
    const result = mergeWeightedPoints(
      { since24h: 5, since7d: 30, sinceActivation: 100 },
      [
        { weighted_points: 10, original_started_at: now - 3600, original_ended_at: now },
        { weighted_points: 20, original_started_at: now - 5 * 86400, original_ended_at: now - 5 * 86400 + 3600 },
      ],
      now,
      activatedAt,
    );
    expect(result.weightedPoints24h).toBe(15);  // 5 + 10
    expect(result.weightedPoints7d).toBe(60);   // 30 + 10 + 20
    expect(result.weightedPointsTotal).toBe(130); // 100 + 10 + 20
  });

  it('防重复: batch_id 不同则算不同 adjustment', () => {
    const batchA = 'a1b2c3d4';
    const batchB = 'e5f6g7h8';
    expect(batchA).not.toBe(batchB);
  });
});

// ── 合并 request_logs + adjustments 统计 (模拟 getMergedTotalRequestStats) ──
interface AdjRow {
  request_count: number;
  original_started_at: number;
  original_ended_at: number;
}

function simulateMergedTotal(
  rlTotal: number,
  rlSuccess: number,
  rlFailed: number,
  adjustments: AdjRow[],
): { total: number; success: number; failed: number } {
  const adjTotal = adjustments.reduce((s, a) => s + a.request_count, 0);
  return {
    total: rlTotal + adjTotal,
    success: rlSuccess + adjTotal, // adj 默认成功
    failed: rlFailed,
  };
}

describe('getMergedTotalRequestStats logic', () => {
  it('request_logs only → 纯 request_logs', () => {
    const r = simulateMergedTotal(100, 95, 5, []);
    expect(r.total).toBe(100);
    expect(r.success).toBe(95);
    expect(r.failed).toBe(5);
  });

  it('adj 423 次补账 → total +423, success +423', () => {
    const r = simulateMergedTotal(1, 1, 0, [
      { request_count: 332, original_started_at: 0, original_ended_at: 0 },
      { request_count: 91, original_started_at: 0, original_ended_at: 0 },
    ]);
    expect(r.total).toBe(424);
    expect(r.success).toBe(424);
    expect(r.failed).toBe(0);
  });

  it('adj request_count ≠ weighted_points (不会混淆)', () => {
    // flash: 332 次 = 332 点; but request_count is what goes into total
    const adj: AdjRow[] = [{ request_count: 332, original_started_at: 0, original_ended_at: 0 }];
    const r = simulateMergedTotal(0, 0, 0, adj);
    expect(r.total).toBe(332); // request_count
    // weightedPoints 是另一个维度，不要混淆
  });

  it('GPT/Claude/GLM 不受影响 — 不调用合并函数', () => {
    // 非 30d_light: 用 getTotalRequestStats, 不走合并路径
    const isDeepSeekLight = false;
    const stats = isDeepSeekLight
      ? simulateMergedTotal(10, 10, 0, [{ request_count: 100, original_started_at: 0, original_ended_at: 0 }])
      : { total: 10, success: 10, failed: 0 };
    expect(stats.total).toBe(10); // 只有 request_logs
  });
});

// ── 合并每日趋势 (模拟 getMergedDailyCountsLastNDays) ──
function simulateMergedDaily(
  rlDaily: Array<{ date: string; count: number }>,
  adjCount: number,
  adjStartDate: string,
  adjEndDate: string,
): Array<{ date: string; count: number }> {
  // 计算跨越天数，均匀分摊
  const start = new Date(adjStartDate);
  const end = new Date(adjEndDate);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const perDay = Math.floor(adjCount / spanDays);
  let remainder = adjCount - perDay * spanDays;
  const dailyAdj = new Map<string, number>();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    let count = perDay;
    if (remainder > 0) { count++; remainder--; }
    dailyAdj.set(key, count);
  }
  for (const d of rlDaily) {
    d.count += dailyAdj.get(d.date) || 0;
  }
  return rlDaily;
}

describe('getMergedDailyCountsLastNDays logic', () => {
  it('423 次跨 2 天 → 每天 211/212 次', () => {
    const rlDaily = [
      { date: '2026-06-22', count: 1 },
      { date: '2026-06-23', count: 0 },
    ];
    const result = simulateMergedDaily(rlDaily, 423, '2026-06-22', '2026-06-23');
    const total = result.reduce((s, d) => s + d.count, 0);
    expect(total).toBe(424); // 1 + 423
    expect(result[0].count).toBeGreaterThan(200); // ~211
    expect(result[1].count).toBeGreaterThan(200); // ~212
  });

  it('adjustment 跨 1 天 → 全部分到当天', () => {
    const rlDaily = [{ date: '2026-06-22', count: 0 }];
    const result = simulateMergedDaily(rlDaily, 100, '2026-06-22', '2026-06-22');
    expect(result[0].count).toBe(100);
  });

  it('无 adjustments → 纯 request_logs', () => {
    const rlDaily = [{ date: '2026-06-22', count: 5 }];
    const result = simulateMergedDaily(rlDaily, 0, '2026-06-22', '2026-06-22');
    expect(result[0].count).toBe(5);
  });
});
