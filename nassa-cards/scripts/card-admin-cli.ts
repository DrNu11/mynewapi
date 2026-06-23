/**
 * card-admin CLI — OpenClaw 微信可调用的本地卡密管理工具
 *
 * 用法:
 *   npm run card-admin -- apply-rph DE-XXXX-XXXX-XXXX
 *   npm run card-admin -- clear-rph DE-XXXX-XXXX-XXXX
 *   npm run card-admin -- disable   DE-XXXX-XXXX-XXXX
 *   npm run card-admin -- status    DE-XXXX-XXXX-XXXX
 *
 * 安全约束:
 *   - 只操作本地 SQLite cards 表
 *   - 不操作 NewAPI / nginx / .env
 *   - 不输出 sk_key
 *   - 不执行 shell
 *   - 不开放网络端口
 */

import {
  getCardByCode,
  applyRphBonus,
  clearRphBonus,
  setCardStatus,
  canUseRphBonus,
  isRphBonusEligible,
  getEffectiveRph,
  countCurrentHourRequestsByCard,
  countCardWeightedPoints,
} from '../lib/db';

/** 卡密格式(用于智能模式识别 — 仅 DE 系列) */
export const DE_PATTERN = /^DE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
/** 通用卡密格式(所有命令通用) */
export const CODE_PATTERN = /^[A-Z]{2,4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function fmtTime(t: number | null): string {
  if (!t) return '-';
  return new Date(t * 1000).toLocaleString('zh-CN', { hour12: false });
}

function formatPlan(card: ReturnType<typeof getCardByCode>): string {
  if (!card) return '-';
  const map: Record<string, string> = {
    '0.5d': '12小时体验',
    '1d': '1天畅用',
    '7d': '7天高速',
    '30d': '30天高速',
    '30d_light': '轻度月卡',
  };
  return map[card.plan] || card.plan;
}

// ==================== actions ====================

export function doApply(code: string): string[] {
  const out: string[] = [];
  const card = getCardByCode(code);
  if (!card) {
    out.push(`卡密 ${code} 不存在`);
    return out;
  }

  if (!isRphBonusEligible(card)) {
    const reasons: string[] = [];
    if (card.category !== 'deepseek') reasons.push('仅支持 DeepSeek 套餐');
    if (!['1d', '7d', '30d'].includes(card.plan)) reasons.push('仅支持 1天/7天/30天');
    if (card.status === 'expired') reasons.push('卡已过期');
    if (card.status === 'disabled') reasons.push('卡已禁用');
    out.push(`该卡不符合好评 +55 条件：${reasons.join('；')}`);
    return out;
  }

  const updated = applyRphBonus(code);
  if (!updated) {
    out.push('操作失败');
    return out;
  }
  out.push(`已为 ${code} 添加好评 +55 RPH`);
  out.push(`基础 RPH: ${card.rph} → 实际 RPH: ${getEffectiveRph(updated)}`);
  return out;
}

export function doClear(code: string): string[] {
  const out: string[] = [];
  const card = getCardByCode(code);
  if (!card) {
    out.push(`卡密 ${code} 不存在`);
    return out;
  }

  clearRphBonus(code);
  out.push(`已撤销 ${code} 的 RPH 加成`);
  out.push(`当前 RPH: ${card.rph}（恢复为基础值）`);
  return out;
}

export function doDisable(code: string): string[] {
  const out: string[] = [];
  const card = getCardByCode(code);
  if (!card) {
    out.push(`卡密 ${code} 不存在`);
    return out;
  }

  const prev = card.status;
  if (prev === 'disabled') {
    out.push(`卡密 ${code} 已经被禁用`);
    return out;
  }

  setCardStatus(code, 'disable', 'CLI 微信指令禁用');
  const updated = getCardByCode(code);
  out.push(`已禁用卡密 ${code}`);
  out.push(`状态: ${prev} → ${updated?.status || '?'}`);
  return out;
}

export function doStatus(code: string): string[] {
  const out: string[] = [];
  const card = getCardByCode(code);
  if (!card) {
    out.push(`卡密 ${code} 不存在`);
    return out;
  }

  const isLight = card.plan === '30d_light';
  const eligible = isRphBonusEligible(card);

  out.push(`卡密: ${card.code}`);
  out.push(`分类: ${card.category || '-'}`);
  out.push(`套餐: ${formatPlan(card)}`);
  out.push(`状态: ${card.status}`);
  out.push(`激活时间: ${fmtTime(card.activated_at)}`);
  out.push(`到期时间: ${fmtTime(card.expires_at)}`);

  if (isLight) {
    const activatedAt = card.activated_at || Math.floor(Date.now() / 1000);
    const now = Math.floor(Date.now() / 1000);
    const pts24h = countCardWeightedPoints(card.id, Math.max(86400, now - activatedAt));
    const pts7d = countCardWeightedPoints(card.id, Math.max(604800, now - activatedAt));
    const ptsTotal = countCardWeightedPoints(card.id, now - activatedAt);
    out.push(`近 24 小时已用点数: ${pts24h} / 2000`);
    out.push(`近 7 天已用点数: ${pts7d} / 10000`);
    out.push(`总已用点数: ${ptsTotal} / 40000`);
    out.push('flash 每次 1 点');
    out.push('pro 每次 3 点');
    out.push('好评 +55 RPH：不支持轻度月卡');
  } else {
    const hour = countCurrentHourRequestsByCard(card.id);
    const effective = canUseRphBonus(card) ? getEffectiveRph(card) : card.rph;
    out.push(`基础 RPH: ${card.rph}`);
    out.push(`RPH 加成: +${card.rph_bonus || 0}`);
    out.push(`实际 RPH: ${effective}`);
    out.push(`当前小时已用: ${hour.used}`);
    out.push(`当前小时上限: ${effective}`);
    out.push(`当前小时剩余: ${Math.max(0, effective - hour.used)}`);
    if (card.rph_bonus_reason) out.push(`加成原因: ${card.rph_bonus_reason}`);
    if (card.rph_bonus_at) out.push(`加成时间: ${fmtTime(card.rph_bonus_at)}`);
    out.push(`符合好评 +55 条件: ${eligible ? '是' : '否'}`);
  }

  return out;
}

// ==================== main ====================

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('用法: npm run card-admin -- <action> <code>');
    console.log('  apply-rph  好评 +55 RPH');
    console.log('  clear-rph  撤回 RPH 加成');
    console.log('  disable    禁用卡密');
    console.log('  status     查询卡密状态');
    process.exit(1);
  }

  const action = args[0];
  let code = args[1] || '';

  // 智能匹配：只传入一个 DE 卡密 → 默认 apply-rph
  if (!code && DE_PATTERN.test(action)) {
    code = action;
    const lines = doApply(code);
    for (const l of lines) console.log(l);
    process.exit(lines[0].startsWith('该卡不') || lines[0].includes('不存在') || lines[0].includes('操作失败') ? 1 : 0);
  }

  if (!code) {
    console.log(`缺少卡密参数\n用法: npm run card-admin -- ${action} <CODE>`);
    process.exit(1);
  }

  if (!CODE_PATTERN.test(code)) {
    console.log(`卡密格式不正确: ${code}\n期望: XX-XXXX-XXXX-XXXX (X=A-Z,0-9)`);
    process.exit(1);
  }

  let lines: string[];
  switch (action) {
    case 'apply-rph': lines = doApply(code); break;
    case 'clear-rph': lines = doClear(code); break;
    case 'disable':   lines = doDisable(code); break;
    case 'status':    lines = doStatus(code); break;
    default:
      console.log(`未知操作: ${action}\n支持: apply-rph / clear-rph / disable / status`);
      process.exit(1);
  }

  for (const l of lines) console.log(l);
  const first = lines[0] || '';
  const failed = first.startsWith('该卡不') || first.includes('不存在') || first.startsWith('操作失败');
  process.exit(failed ? 1 : 0);
}

// tsx 执行入口；import 时不执行
const isMain = process.argv[1]?.includes('card-admin-cli');
if (isMain) main();
