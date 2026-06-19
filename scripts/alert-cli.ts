/**
 * alert CLI — OpenClaw 可调用的平台告警查询工具
 *
 * 用法:
 *   npm run alert -- status
 *   npm run alert -- quota
 *   npm run alert -- channels
 *   npm run alert -- errors [N]
 *   npm run alert -- diagnose DE-XXXX-XXXX-XXXX
 *
 * 安全约束:
 *   - 只读查询，不修改任何数据
 *   - 不输出 API Key / sk_key
 *   - 不执行破坏性 shell
 */

import {
  getCardByCode,
  getStats,
  countCurrentHourRequestsByCard,
  getEffectiveRph,
  countCardWeightedPoints,
  canUseRphBonus,
  isRphBonusEligible,
} from '../lib/db';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// tsx 不会像 Next.js 那样自动加载 .env.local，CLI 需要手动加载
function loadEnvLocal() {
  try {
    const content = readFileSync('.env.local', 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env.local 不存在就跳过 */ }
}
loadEnvLocal();

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

function getMysqlCliArgs(): string | null {
  const dsn = process.env.NEWAPI_SQL_DSN || '';
  const m = /^([^:]+):([^@]+)@tcp\(([^)]+)\)\/([^?]+)/.exec(dsn);
  if (!m) return null;
  const [, user, pass, hostPort, db] = m;
  const idx = hostPort.lastIndexOf(':');
  const host = idx >= 0 ? hostPort.slice(0, idx) : hostPort;
  const port = idx >= 0 ? hostPort.slice(idx + 1) : '3306';
  return `-h${host} -P${port} -u${user} -p${pass} ${db}`;
}

function safeExec(cmd: string, timeoutSec = 10): string {
  try {
    return execSync(cmd, { timeout: timeoutSec * 1000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
  } catch {
    return '';
  }
}

// ==================== actions ====================

export function doStatus(): string[] {
  const out: string[] = [];

  // 卡密统计
  const stats = getStats();
  out.push('—— 卡密统计 ——');
  out.push(`总计: ${stats.total} | 未使用: ${stats.unused} | 已激活: ${stats.activated} | 已过期: ${stats.expired}`);
  const plans = Object.entries(stats.by_plan)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  if (plans) out.push(`套餐分布: ${plans}`);

  // 错误概览
  const errs = safeExec(
    "docker logs --tail 2000 newapi-prod-new-api-1 2>&1 | grep -cE '(relay error|channel error|重试|502|524)' || true",
    15,
  ).trim();
  const errCount = parseInt(errs, 10) || 0;
  out.push('');
  out.push('—— 网关错误 ——');
  out.push(`最近 2000 行日志错误数: ${errCount}${errCount > 50 ? ' (偏高)' : ''}`);

  // 渠道概览
  const mysqlArgs = getMysqlCliArgs();
  if (mysqlArgs) {
    const chRaw = safeExec(
      `docker exec newapi-prod-mysql-1 mysql ${mysqlArgs} -N -e "SELECT COUNT(*) AS total, SUM(CASE WHEN status=1 THEN 1 ELSE 0 END) AS enabled FROM channels" 2>/dev/null || true`,
      10,
    ).trim();
    if (chRaw) {
      const parts = chRaw.split(/\s+/);
      if (parts.length >= 2) {
        out.push('');
        out.push('—— 渠道状态 ——');
        out.push(`渠道总数: ${parts[0]} | 已启用: ${parts[1]}`);
      }
    }
  }

  return out;
}

export function doQuota(): string[] {
  const out: string[] = [];
  out.push('—— MiniMax 配额 ——');

  const minimaxKey = process.env.MINIMAX_API_KEY || '';
  if (!minimaxKey) {
    out.push('未配置 MINIMAX_API_KEY 环境变量');
    return out;
  }

  const raw = safeExec(
    `curl -s --max-time 10 "https://www.minimaxi.com/v1/token_plan/remains" -H "Authorization: Bearer ${minimaxKey}" 2>/dev/null || true`,
    12,
  ).trim();

  if (!raw) {
    out.push('无法获取配额数据（API 不可达）');
    return out;
  }

  try {
    const data = JSON.parse(raw);
    if (data.base_resp?.status_code !== 0) {
      out.push(`API 返回错误: ${data.base_resp?.status_msg || 'unknown'}`);
      return out;
    }

    const models = data.model_remains;
    if (!Array.isArray(models) || models.length === 0) {
      out.push('无配额数据');
      return out;
    }

    for (const m of models) {
      const name = m.model_name || '?';
      const intervalPct = m.current_interval_remaining_percent ?? '?';
      const weeklyPct = m.current_weekly_remaining_percent ?? '?';

      const intervalWarn = Number(intervalPct) < 20 ? ' 偏低' : '';
      const weeklyWarn = Number(weeklyPct) < 30 ? ' 偏低' : '';

      out.push(`${name}: 5h剩余 ${intervalPct}%${intervalWarn} | 周剩余 ${weeklyPct}%${weeklyWarn}`);
    }
  } catch {
    out.push('配额数据解析失败');
    if (raw.length < 200) out.push(`原始响应: ${raw}`);
  }

  return out;
}

export function doChannels(): string[] {
  const out: string[] = [];
  out.push('—— 渠道状态 ——');

  const mysqlArgs = getMysqlCliArgs();
  if (!mysqlArgs) {
    out.push('无法获取 MySQL 连接信息');
    return out;
  }

  const raw = safeExec(
    `docker exec newapi-prod-mysql-1 mysql ${mysqlArgs} -N -e "SELECT id, name, type, status, auto_ban, priority FROM channels ORDER BY id" 2>/dev/null || true`,
    10,
  ).trim();

  if (!raw) {
    out.push('无法查询渠道数据');
    return out;
  }

  const lines = raw.split('\n').filter(Boolean);
  const interesting: string[] = [];
  for (const line of lines) {
    const cols = line.split('\t');
    const [id, name, type, status, autoBan, priority] = cols;
    const statusNum = parseInt(status, 10);
    const autoBanNum = parseInt(autoBan, 10);

    if (statusNum !== 1 || autoBanNum === 1) {
      interesting.push(
        `${id} ${name || '-'} 状态:${statusNum === 1 ? '启用' : '禁用'} 自动封禁:${autoBanNum === 1 ? '是' : '否'} 优先级:${priority || '-'}`,
      );
    }
  }

  if (interesting.length === 0) {
    out.push('所有渠道正常');
  } else {
    out.push(`异常渠道 ${interesting.length} 个:`);
    for (const ch of interesting) out.push(`  ${ch}`);
  }

  out.push(`(共 ${lines.length} 个渠道)`);
  return out;
}

export function doErrors(n = 20): string[] {
  const out: string[] = [];
  const limit = Math.min(Math.max(n, 1), 100);
  out.push(`—— 最近 ${limit} 条网关错误 ——`);

  const raw = safeExec(
    `docker logs --tail 3000 newapi-prod-new-api-1 2>&1 | grep -E '(relay error|channel error|重试|\\| 502 \\||\\| 524 \\|)' | tail -n ${limit} || true`,
    15,
  ).trim();

  if (!raw) {
    out.push('暂无错误');
    return out;
  }

  const lines = raw.split('\n');
  for (const line of lines) {
    out.push(line.length > 300 ? line.slice(0, 300) + '...' : line);
  }

  return out;
}

export function doDiagnose(code: string): string[] {
  const out: string[] = [];
  const card = getCardByCode(code);
  if (!card) {
    out.push(`卡密 ${code} 不存在`);
    return out;
  }

  const isLight = card.plan === '30d_light';

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
    out.push(`近 24h 点数: ${pts24h} / 2000`);
    out.push(`近 7d 点数: ${pts7d} / 10000`);
    out.push(`总点数: ${ptsTotal} / 40000`);
  } else {
    const hour = countCurrentHourRequestsByCard(card.id);
    const effective = canUseRphBonus(card) ? getEffectiveRph(card) : card.rph;
    out.push(`基础 RPH: ${card.rph}`);
    out.push(`RPH 加成: +${card.rph_bonus || 0}`);
    out.push(`实际 RPH: ${effective}`);
    out.push(`当前小时已用: ${hour.used}`);
    out.push(`当前小时剩余: ${Math.max(0, effective - hour.used)}`);
    if (hour.used > 0 && effective > 0) {
      const pct = ((hour.used / effective) * 100).toFixed(1);
      out.push(`使用率: ${pct}%${Number(pct) > 80 ? ' 接近上限' : ''}`);
    }
    if (card.rph_bonus_reason) out.push(`加成原因: ${card.rph_bonus_reason}`);
    out.push(`符合好评 +55 条件: ${isRphBonusEligible(card) ? '是' : '否'}`);
  }

  return out;
}

// ==================== main ====================

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('用法: npm run alert -- <action> [args]');
    console.log('  status         平台总览');
    console.log('  quota          MiniMax 配额');
    console.log('  channels       渠道状态');
    console.log('  errors [N]     最近 N 条错误 (默认 20)');
    console.log('  diagnose CODE  诊断卡密');
    process.exit(1);
  }

  const action = args[0];
  let lines: string[];

  switch (action) {
    case 'status':
      lines = doStatus();
      break;
    case 'quota':
      lines = doQuota();
      break;
    case 'channels':
      lines = doChannels();
      break;
    case 'errors': {
      const n = args[1] ? parseInt(args[1], 10) : 20;
      if (isNaN(n) || n < 1 || n > 100) {
        console.log('错误数量需在 1-100 之间');
        process.exit(1);
      }
      lines = doErrors(n);
      break;
    }
    case 'diagnose': {
      const code = args[1] || '';
      if (!code) {
        console.log('缺少卡密参数\n用法: npm run alert -- diagnose <CODE>');
        process.exit(1);
      }
      if (!CODE_PATTERN.test(code)) {
        console.log(`卡密格式不正确: ${code}\n期望: XX-XXXX-XXXX-XXXX`);
        process.exit(1);
      }
      lines = doDiagnose(code);
      break;
    }
    default:
      console.log(`未知操作: ${action}\n支持: status / quota / channels / errors / diagnose`);
      process.exit(1);
  }

  for (const l of lines) console.log(l);
}

// tsx 执行入口；import 时不执行
const isMain = process.argv[1]?.includes('alert-cli');
if (isMain) main();
