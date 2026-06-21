/**
 * /api/usage - 查询某个 sk-key 的实时小时内用量
 *
 * 给 result 页轮询用,让客户看到 "已用 X / Y 次,剩余 Z 次"。
 * 同时也防 IP 爆破:每 IP 每分钟最多 60 次查询(轮询间隔大于 1s 即可)。
 *
 * 安全考虑:用 POST + body 传 sk,避免 query 串落到日志。
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  countCurrentHourRequests,
  getCardByTokenKey,
  getModelsUsedCurrentHour,
  getTotalRequestStats,
  getDailyCountsLastNDays,
  getDailyCountsByModelLastNDays,
  getTopModelsLastNDays,
  getEffectiveRph,
  getGlmRequestUsage,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(`usage:${ip}`, 60, 60)) {
    return NextResponse.json(
      { success: false, message: '查询过于频繁,请稍后再试' },
      { status: 429 }
    );
  }

  let body: { sk?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: '请求格式错误' }, { status: 400 });
  }

  const sk = (body.sk || '').trim();
  if (!sk || !sk.startsWith('sk-')) {
    return NextResponse.json({ success: false, message: 'sk 参数缺失或非法' }, { status: 400 });
  }

  const card = getCardByTokenKey(sk);
  if (!card) {
    return NextResponse.json({ success: false, message: 'sk 不存在' }, { status: 404 });
  }
  if (card.status === 'disabled') {
    return NextResponse.json(
      { success: false, message: card.disable_reason || '该卡密已被禁用,请联系客服' },
      { status: 403 }
    );
  }

  const { used, hourStart, nextResetAt } = countCurrentHourRequests(sk);
  const effectiveRph = getEffectiveRph(card);
  const remaining = effectiveRph > 0 ? Math.max(0, effectiveRph - used) : -1; // -1 = 不限
  const modelsUsed = getModelsUsedCurrentHour(sk);
  const requestUsage = getGlmRequestUsage(card);

  // 扩展看板统计:总览、近 7 天趋势、7 天模型 top
  const totalStats = getTotalRequestStats(sk);
  const daily7d = getDailyCountsLastNDays(sk, 7);
  const dailyByModel7d = getDailyCountsByModelLastNDays(sk, 7);
  const topModels7d = getTopModelsLastNDays(sk, 7, 5);
  const successRate =
    totalStats.total > 0
      ? Math.round((totalStats.success / totalStats.total) * 1000) / 10 // 保留 1 位小数的百分数
      : 100;

  return NextResponse.json({
    success: true,
    data: {
      used,
      rph: effectiveRph,
      rph_base: card.rph || 0,
      rph_bonus: card.rph_bonus || 0,
      remaining,
      category: card.category,
      plan: card.plan,
      requestQuota: requestUsage.requestQuota,
      requestBonusQuota: requestUsage.requestBonusQuota,
      effectiveRequestQuota: requestUsage.effectiveRequestQuota,
      usedRequests: requestUsage.usedRequests,
      remainingRequests: requestUsage.remainingRequests,
      bonusReason: card.request_bonus_reason,
      window_sec: 3600,
      hour_start: hourStart, // 当前整点窗口起始 unix 秒
      next_reset_at: nextResetAt, // 下一次重置 unix 秒(前端做倒计时)
      models_used: modelsUsed, // 本小时调用过的模型分布 [{model, count}]
      // 扩展字段(给看板用)
      total_requests: totalStats.total,
      success_count: totalStats.success,
      failed_count: totalStats.failed,
      success_rate: successRate, // 百分数,如 98.3
      daily_7d: daily7d, // [{date: '2026-05-10', count: 1234}, ...]
      daily_by_model_7d: dailyByModel7d, // [{date, total, by_model: {model: count}}, ...] 供堆叠柱状图
      top_models_7d: topModels7d, // [{model, count}, ...] top 5
    },
  });
}
