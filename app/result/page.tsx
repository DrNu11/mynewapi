'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Clock, KeyRound, Globe, ArrowLeft, BookOpen, Terminal, Zap, RefreshCw, BarChart3, ExternalLink, Sparkles, RotateCw, Loader2, CheckCircle2 } from 'lucide-react';
import { formatDaysCN } from '@/lib/plans';

interface ResultData {
  api_key: string;
  base_url: string;
  plan: string;
  plan_days: number;
  category: 'deepseek' | 'gpt' | 'claude' | null;
  category_label: string | null;
  has_codex: boolean;
  rph: number;
  activated_at: number;
  /** null = 永不过期(尊享套餐,只受额度约束) */
  expires_at: number | null;
  models: string[];
}

type Os = 'mac' | 'win';

/**
 * 生成给客户的 Codex CLI 一键配置命令
 * 命令做的事:下载 codex-setup.js 脚本 → 用 node 跑,自动智能合并 NassaAPI 配置
 * 优点:保留客户原有 [mcp_servers.*] / [projects.*] 配置,清掉错位 base_url 等
 */
function buildCodexCommand(os: Os, sk: string, origin: string): string {
  // ?v=... cache-busting:避免 Cloudflare/浏览器 缓存旧版脚本
  // 每次打开 result 页都刷新 ts,确保拉到最新带防御性清理逻辑的 codex-setup.js
  const ts = Math.floor(Date.now() / 1000);
  const scriptUrl = `${origin}/scripts/codex-setup.js?v=${ts}`;
  if (os === 'mac') {
    return `SK="${sk}"; curl -fsSL "${scriptUrl}" -o /tmp/codex-setup.js && node /tmp/codex-setup.js "$SK"`;
  }
  // Windows PowerShell 单行命令
  return `$SK="${sk}"; $tmp="$env:TEMP\\codex-setup.js"; iwr "${scriptUrl}" -OutFile $tmp -UseBasicParsing; node $tmp "$SK"`;
}

/**
 * 生成 CC Switch 一键导入 deeplink — 按套餐 category 选 app type / model
 *
 * CC Switch (farion1231/cc-switch) 支持 ccswitch:// 协议从 URL 直接导入供应商。
 * 走 ProviderService::add 路径,内部用 format! 拼出正确的 config.toml,
 * 完全绕过 CC Switch "手动新建供应商" 那条有 bug 的写入路径
 * (即把 base_url 错位写到 [tui.model_availability_nux] 等深层段尾)。
 *
 * App type 映射(基于 cc-switch/src-tauri/src/deeplink/provider.rs 的 build_*):
 *   - gpt      → app=codex(走 OpenAI Response /v1/responses 协议,适配 Codex CLI)
 *   - deepseek → app=openclaw(走 OpenAI Chat Completions /v1/chat/completions,DeepSeek 不支持 responses)
 *   - claude   → app=claude(走 Anthropic Messages /v1/messages 协议,适配 Claude Code CLI)
 */
function buildCcswitchDeeplink(
  category: 'deepseek' | 'gpt' | 'claude' | null,
  sk: string
): string | null {
  let app: string;
  let model: string;
  let endpoint: string;
  let name: string;

  if (category === 'gpt') {
    app = 'codex';
    model = 'gpt-5.5';
    endpoint = 'https://card.nassaapi.xyz/v1';
    name = 'NassaAPI-GPT';
  } else if (category === 'deepseek') {
    app = 'openclaw';
    model = 'deepseek-v4-flash';
    endpoint = 'https://card.nassaapi.xyz/v1';
    name = 'NassaAPI-DeepSeek';
  } else if (category === 'claude') {
    app = 'claude';
    model = 'claude-opus-4-7';
    // Claude Code CLI 自己拼 /v1/messages,base URL 不带 /v1
    endpoint = 'https://card.nassaapi.xyz';
    name = 'NassaAPI-Claude';
  } else {
    // 老 NASSA- 卡密(category=null),不显示一键导入
    return null;
  }

  const params = new URLSearchParams({
    resource: 'provider',
    app,
    name,
    endpoint,
    apiKey: sk,
    model,
    enabled: 'true',
    homepage: 'https://card.nassaapi.xyz',
  });
  return `ccswitch://v1/import?${params.toString()}`;
}

/** CC Switch 一键导入按钮显示文案(按套餐 category) */
function ccswitchBadgeText(category: 'deepseek' | 'gpt' | 'claude' | null): {
  title: string;
  desc: string;
} {
  if (category === 'gpt') {
    return {
      title: 'CC Switch 一键导入(Codex CLI)',
      desc: '点击直接添加 NassaAPI-GPT 供应商到 CC Switch 并启用,Codex CLI 立刻能用',
    };
  }
  if (category === 'deepseek') {
    return {
      title: 'CC Switch 一键导入(OpenClaw / OpenAI 兼容)',
      desc: '点击直接添加 NassaAPI-DeepSeek 供应商到 CC Switch 并启用,OpenClaw / 任何 OpenAI Chat Completions 客户端立刻能用',
    };
  }
  if (category === 'claude') {
    return {
      title: 'CC Switch 一键导入(Claude Code CLI)',
      desc: '点击直接添加 NassaAPI-Claude 供应商到 CC Switch 并启用,Claude Code CLI 立刻能用',
    };
  }
  return { title: '', desc: '' };
}

interface ModelCount {
  model: string;
  count: number;
}

interface DailyCount {
  date: string;
  count: number;
}

interface DailyByModel {
  date: string;
  total: number;
  by_model: Record<string, number>;
}

interface UsageState {
  used: number;
  rph: number;
  remaining: number;
  loading: boolean;
  fetchedAt: number; // unix sec
  nextResetAt?: number; // unix sec,下一次整点重置
  modelsUsed?: ModelCount[]; // 本小时调用过的模型分布
  // 扩展看板字段
  totalRequests?: number;
  successCount?: number;
  failedCount?: number;
  successRate?: number; // 百分数
  daily7d?: DailyCount[];
  dailyByModel7d?: DailyByModel[];
  topModels7d?: ModelCount[];
}

// 模型名 → 颜色(按名哈希 → HSL 色相,保证同名同色、各模型色相均匀)
function modelColor(model: string): { bg: string; border: string; text: string } {
  let hash = 0;
  for (let i = 0; i < model.length; i++) {
    hash = (hash << 5) - hash + model.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 70%, 55%)`,
    border: `hsl(${hue}, 70%, 45%)`,
    text: `hsl(${hue}, 70%, 75%)`,
  };
}

export default function ResultPage() {
  const router = useRouter();
  const [data, setData] = useState<ResultData | null>(null);
  const [already, setAlready] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [os, setOs] = useState<Os>('mac');
  const [origin, setOrigin] = useState<string>('');
  const [usage, setUsage] = useState<UsageState | null>(null);
  // 续费状态
  const [renewCode, setRenewCode] = useState('');
  const [renewLoading, setRenewLoading] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);
  const [renewSuccess, setRenewSuccess] = useState<{
    added_days: number;
    before_expires_at: number;
    after_expires_at: number;
  } | null>(null);
  // 每秒 tick,让 "X 秒前" 显示自动滚动
  const [nowSec, setNowSec] = useState<number>(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // 自动识别操作系统(失败也无所谓,默认 mac)
    if (typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)) {
      setOs('win');
    }
    // 当前域名(支持客户从 IP+端口 或 https://card.nassaapi.xyz 进入,脚本下载用同一来源)
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem('nc_result');
    if (!raw) {
      router.replace('/');
      return;
    }
    setData(JSON.parse(raw));
    setAlready(sessionStorage.getItem('nc_already') === '1');
  }, [router]);

  // 拉实时用量,页面留着就每 60s 自动刷新(手动刷新另走 refresh 函数)
  // 注意:所有卡密都 fetch(包括 rph=0 不限的老卡),看板需要展示累计/趋势/模型 top
  useEffect(() => {
    if (!data?.api_key) return;
    let alive = true;
    const fetchUsage = async () => {
      setUsage((u) => (u ? { ...u, loading: true } : u));
      try {
        const r = await fetch('/api/usage', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sk: data.api_key }),
        });
        const j = await r.json();
        if (!alive || !j?.success) return;
        setUsage({
          used: j.data.used,
          rph: j.data.rph,
          remaining: j.data.remaining,
          nextResetAt: j.data.next_reset_at,
          modelsUsed: j.data.models_used || [],
          totalRequests: j.data.total_requests,
          successCount: j.data.success_count,
          failedCount: j.data.failed_count,
          successRate: j.data.success_rate,
          daily7d: j.data.daily_7d,
          dailyByModel7d: j.data.daily_by_model_7d,
          topModels7d: j.data.top_models_7d,
          loading: false,
          fetchedAt: Math.floor(Date.now() / 1000),
        });
      } catch {
        if (alive) setUsage((u) => (u ? { ...u, loading: false } : u));
      }
    };
    fetchUsage();
    const t = setInterval(fetchUsage, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [data?.api_key, data?.rph]);

  const refreshUsage = async () => {
    if (!data?.api_key) return;
    setUsage((u) => (u ? { ...u, loading: true } : u));
    try {
      const r = await fetch('/api/usage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sk: data.api_key }),
      });
      const j = await r.json();
      if (j?.success) {
        setUsage({
          used: j.data.used,
          rph: j.data.rph,
          remaining: j.data.remaining,
          nextResetAt: j.data.next_reset_at,
          modelsUsed: j.data.models_used || [],
          totalRequests: j.data.total_requests,
          successCount: j.data.success_count,
          failedCount: j.data.failed_count,
          successRate: j.data.success_rate,
          daily7d: j.data.daily_7d,
          dailyByModel7d: j.data.daily_by_model_7d,
          topModels7d: j.data.top_models_7d,
          loading: false,
          fetchedAt: Math.floor(Date.now() / 1000),
        });
      } else {
        setUsage((u) => (u ? { ...u, loading: false } : u));
      }
    } catch {
      setUsage((u) => (u ? { ...u, loading: false } : u));
    }
  };

  async function handleRenew(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.api_key) return;
    const code = renewCode.trim().toUpperCase();
    if (!code) {
      setRenewError('请输入续费卡密');
      return;
    }
    setRenewError(null);
    setRenewSuccess(null);
    setRenewLoading(true);
    try {
      const res = await fetch('/api/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sk: data.api_key, code }),
      });
      const body = await res.json();
      if (!body.success) {
        setRenewError(body.message || '续费失败');
        setRenewLoading(false);
        return;
      }
      const newData = { ...data, expires_at: body.data.after_expires_at };
      setData(newData);
      sessionStorage.setItem('nc_result', JSON.stringify(newData));
      setRenewSuccess({
        added_days: body.data.added_days,
        before_expires_at: body.data.before_expires_at,
        after_expires_at: body.data.after_expires_at,
      });
      setRenewCode('');
      setRenewLoading(false);
    } catch (err) {
      setRenewError(err instanceof Error ? err.message : '网络错误');
      setRenewLoading(false);
    }
  }

  if (!data) return null;

  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleBackToHome = () => {
    sessionStorage.setItem('nc_skip_cache_redirect', '1');
    window.location.assign('/');
  };

  // expires_at 为 null = 尊享套餐(永不过期,只受额度约束)
  const noExpire = data.expires_at === null;
  const expiresDate = noExpire ? null : new Date(data.expires_at! * 1000);
  const remainHours = noExpire
    ? Infinity
    : Math.max(0, (data.expires_at! - Math.floor(Date.now() / 1000)) / 3600);
  const remainText = noExpire
    ? '不过期 (额度用完为止)'
    : remainHours > 48
      ? `${Math.floor(remainHours / 24)} 天 ${Math.floor(remainHours % 24)} 小时`
      : `${remainHours.toFixed(1)} 小时`;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-3xl px-6 pt-12 pb-20">
        <button
          type="button"
          onClick={handleBackToHome}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>

        <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-400 inline-block">
          {already ? '✓ 已激活,以下为绑定的 API Key' : '✓ 激活成功'}
        </div>

        <h1 className="mt-4 text-3xl font-bold text-slate-100">
          {data.category_label ? `${data.category_label} · ` : ''}{formatDaysCN(data.plan_days)}畅用已开通
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          请妥善保存以下信息,粘贴到 Cherry Studio / Claude Code / Cursor 等工具即可使用
        </p>

        <a
          href="/chat"
          className="mt-8 flex items-center justify-between gap-4 rounded-xl border border-brand-500/50 bg-brand-500/10 px-5 py-4 shadow-lg shadow-brand-500/10 transition hover:border-brand-400 hover:bg-brand-500/15"
        >
          <div className="flex min-w-0 items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-300" />
            <div className="min-w-0">
              <div className="font-semibold text-slate-100">智能网页聊天端已就绪</div>
              <div className="mt-1 text-sm text-slate-400">
                无需配置客户端软件,点击即可与您的 AI 助手在线对话。
              </div>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white">
            立即在线体验
            <ExternalLink className="h-4 w-4" />
          </span>
        </a>

        {/* API Key */}
        <div className="mt-8 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <KeyRound className="h-4 w-4 text-brand-400" />
            API Key
          </label>
          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-emerald-300">
              {data.api_key}
            </code>
            <button
              onClick={() => copy(data.api_key, 'key')}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              {copied === 'key' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === 'key' ? '已复制' : '复制'}
            </button>
          </div>
        </div>

        {/* Base URL */}
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Globe className="h-4 w-4 text-brand-400" />
            Base URL
          </label>

          {/* 协议大徽章 — 一眼看清 OpenAI 加 /v1 / Claude 不加 */}
          {data.category === 'claude' ? (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-orange-500/50 bg-orange-500/10 px-3 py-2 text-orange-200">
              <span className="text-base leading-none">🟠</span>
              <div className="text-sm leading-snug">
                <span className="font-semibold text-orange-100">Claude Code 客户端 · 不要加 /v1</span>
                <div className="mt-0.5 text-xs text-orange-200/80">
                  Claude Code 会自动拼 <code className="rounded bg-slate-900 px-1 font-mono text-[11px]">/v1/messages</code>;手动加 /v1 反而会变成 <code className="rounded bg-slate-900 px-1 font-mono text-[11px]">/v1/v1/messages</code> 报 404
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-emerald-200">
              <span className="text-base leading-none">🟢</span>
              <div className="text-sm leading-snug">
                <span className="font-semibold text-emerald-100">OpenAI 兼容客户端 · URL 必须带 /v1</span>
                <div className="mt-0.5 text-xs text-emerald-200/80">
                  Cherry Studio / Cursor / Codex / NextChat 等,SDK 会拼 <code className="rounded bg-slate-900 px-1 font-mono text-[11px]">/chat/completions</code>;少了 /v1 会 404
                </div>
              </div>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <code className="flex-1 break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-100">
              {data.base_url}
            </code>
            <button
              onClick={() => copy(data.base_url, 'url')}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
            >
              {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied === 'url' ? '已复制' : '复制'}
            </button>
          </div>
        </div>

        {/* 信息 + 升级套餐 CTA — 永远显示 CTA,文案按套餐时长动态 */}
        {(() => {
          const planDays = data.plan_days || 0;
          let ctaTitle = '不想用日卡?';
          let ctaDesc = '周卡 · 月卡套餐 · 大额包月更划算';
          if (planDays >= 30) {
            ctaTitle = '想要更长套餐?';
            ctaDesc = '官方中转站 · 包月稳定低价 · 大额更划算';
          } else if (planDays >= 7) {
            ctaTitle = '想要更长套餐?';
            ctaDesc = '月卡 · 大额包月更划算';
          }
          return (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
                  <BookOpen className="h-4 w-4 text-blue-400" />
                  可用模型
                  <span className="ml-auto rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5 font-mono text-xs text-slate-400">
                    {data.models.length} 个
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-slate-100">
                  {data.models.map((m) => (
                    <div
                      key={m}
                      className="flex items-center gap-1.5 font-mono"
                      title={m}
                    >
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400/70" />
                      <span className="break-all">{m}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
                <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
                  <Clock className="h-4 w-4 text-emerald-400" />
                  到期时间
                </div>
                <div className="mt-3 font-mono text-xl font-medium text-slate-100">
                  {expiresDate ? expiresDate.toLocaleString('zh-CN', { hour12: false }) : '永久'}
                </div>
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-sm font-medium text-emerald-300">
                  <Zap className="h-3.5 w-3.5" />
                  {noExpire ? remainText : `剩余 ${remainText}`}
                </div>
              </div>
              <a
                href="https://api.nassaapi.xyz"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col justify-between rounded-xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-amber-500/5 p-5 transition hover:border-amber-400/60 hover:from-amber-500/25 hover:shadow-lg hover:shadow-amber-500/20"
              >
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-amber-200">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    {ctaTitle}
                  </div>
                  <div className="mt-2 text-base font-bold text-amber-100">
                    试试官方中转站
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-amber-200/80">
                    {ctaDesc}
                    <br />
                    稳定低价 · 注册即用
                  </p>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 self-start rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 transition group-hover:bg-amber-500/20">
                  前往 api.nassaapi.xyz
                  <ExternalLink className="h-3 w-3" />
                </div>
              </a>
            </div>
          );
        })()}

        {/* 速率限制 + 实时用量 */}
        {data.rph > 0 && (
          <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-blue-200">
                <Zap className="h-4 w-4" />
                本小时请求用量
              </div>
              <div className="flex items-center gap-2">
                {usage && !usage.loading && (
                  <span className="text-[10px] text-slate-500">
                    {nowSec - usage.fetchedAt < 5
                      ? '刚刚更新'
                      : `${Math.max(0, nowSec - usage.fetchedAt)} 秒前`}
                  </span>
                )}
                <button
                  onClick={refreshUsage}
                  disabled={usage?.loading}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-100 hover:bg-blue-500/20 disabled:opacity-50"
                  title="手动刷新"
                >
                  <RefreshCw className={`h-3 w-3 ${usage?.loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
            </div>

            {usage ? (
              <>
                {/* 主数字:左边 used / rph 占主,右边剩余 chip */}
                <div className="mt-4 flex items-end justify-between">
                  <div className="flex items-end gap-2 font-mono">
                    <span
                      className={`text-5xl font-bold leading-none transition-all ${usage.used / usage.rph >= 1
                        ? 'text-red-400'
                        : usage.used / usage.rph >= 0.8
                          ? 'text-amber-300'
                          : 'text-blue-100'
                        }`}
                    >
                      {usage.used}
                    </span>
                    <span className="text-xl text-slate-500 leading-none mb-1">
                      / {usage.rph}
                    </span>
                  </div>
                  <div
                    className={`rounded-md border px-2.5 py-1 font-mono text-xs ${usage.remaining === 0
                      ? 'border-red-500/40 bg-red-500/10 text-red-300'
                      : usage.remaining < usage.rph * 0.2
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                      }`}
                  >
                    剩余 {usage.remaining} 次
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full transition-all duration-500 ${usage.used / usage.rph >= 1
                      ? 'bg-red-500'
                      : usage.used / usage.rph >= 0.8
                        ? 'bg-amber-500'
                        : 'bg-emerald-500'
                      }`}
                    style={{ width: `${Math.min(100, (usage.used / usage.rph) * 100)}%` }}
                  />
                </div>

                {/* 本小时调用模型分布 */}
                {usage.modelsUsed && usage.modelsUsed.length > 0 && (
                  <div className="mt-4 border-t border-slate-700/60 pt-3">
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      本小时调用模型
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {usage.modelsUsed.map((m) => (
                        <span
                          key={m.model}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 font-mono text-xs text-slate-200"
                        >
                          <span>{m.model}</span>
                          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-200">
                            ×{m.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                加载中…
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] leading-relaxed text-blue-200/70">
              <span>
                上限 <span className="font-mono text-blue-100">{data.rph}</span> 次/小时,整点(<span className="font-mono">hh:00</span>)自动重置归零,超出返回 HTTP 429。建议单进程使用。
              </span>
              {usage?.nextResetAt && (() => {
                const diff = Math.max(0, usage.nextResetAt - nowSec);
                const m = Math.floor(diff / 60);
                const s = diff % 60;
                const dt = new Date(usage.nextResetAt * 1000);
                const hh = String(dt.getHours()).padStart(2, '0');
                const mm = String(dt.getMinutes()).padStart(2, '0');
                return (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 font-mono text-blue-100">
                    <Clock className="h-3 w-3" />
                    下一次重置 {hh}:{mm} · 还 {m} 分 {String(s).padStart(2, '0')} 秒
                  </span>
                );
              })()}
            </div>
          </div>
        )}

        {/* 数据看板 — 套餐使用情况(总览 + 7 天趋势 + 模型 top),没数据也显示 0 */}
        {usage && (
          <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
              <BarChart3 className="h-4 w-4 text-purple-400" />
              套餐数据看板
              <span className="ml-auto text-[10px] text-slate-500">
                近 7 天聚合
              </span>
            </div>

            {/* 3 列总览统计 */}
            <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  累计请求
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-slate-100">
                  {(usage.totalRequests ?? 0).toLocaleString()}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  成功 {(usage.successCount ?? 0).toLocaleString()} · 失败{' '}
                  {usage.failedCount ?? 0}
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  成功率
                </div>
                <div
                  className={`mt-1 font-mono text-xl font-bold ${(usage.successRate ?? 100) >= 95
                    ? 'text-emerald-300'
                    : (usage.successRate ?? 100) >= 80
                      ? 'text-amber-300'
                      : 'text-red-300'
                    }`}
                >
                  {(usage.successRate ?? 100).toFixed(1)}%
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  HTTP 2xx/3xx 计入
                </div>
              </div>

              <div className="rounded-lg border border-slate-700/60 bg-slate-950/50 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  套餐类型
                </div>
                <div className="mt-1 font-mono text-base font-bold text-slate-100 break-words">
                  {data.category_label ?? '—'}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  每小时上限 {data.rph || '不限'}
                </div>
              </div>
            </div>

            {/* 近 7 天请求趋势 — 按模型堆叠柱状图(stacked),每段一个颜色 */}
            {usage.dailyByModel7d && usage.dailyByModel7d.length > 0 && (() => {
              const maxVal = Math.max(...usage.dailyByModel7d.map((d) => d.total), 1);
              const todayKey = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
              })();
              const MAX_BAR_PX = 160;
              // 收集出现过的所有模型(近7天，按总调用量倒序),用于 legend
              const modelTotals: Record<string, number> = {};
              usage.dailyByModel7d.forEach((d) => {
                Object.entries(d.by_model).forEach(([m, c]) => {
                  modelTotals[m] = (modelTotals[m] || 0) + c;
                });
              });
              const allModels = Object.keys(modelTotals).sort(
                (a, b) => modelTotals[b] - modelTotals[a],
              );
              return (
                <div className="mt-5 rounded-lg border border-slate-700/60 bg-slate-950/40 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500">
                      近 7 天请求趋势 · 按模型堆叠
                    </span>
                    <span className="text-[10px] text-slate-500">
                      峰值 <span className="font-mono text-slate-300">{maxVal.toLocaleString()}</span> 次/天
                    </span>
                  </div>
                  {/* legend */}
                  {allModels.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                      {allModels.map((m) => {
                        const c = modelColor(m);
                        return (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1.5 text-[11px]"
                            title={`${m} · 总共 ${modelTotals[m]} 次`}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm"
                              style={{ background: c.bg }}
                            />
                            <span className="font-mono" style={{ color: c.text }}>
                              {m}
                            </span>
                            <span className="font-mono text-slate-500">{modelTotals[m]}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-7 gap-2">
                    {usage.dailyByModel7d.map((d) => {
                      const ratio = d.total / maxVal;
                      const totalBarPx = d.total === 0 ? 4 : Math.max(12, Math.round(ratio * MAX_BAR_PX));
                      const isToday = d.date === todayKey;
                      // 该天按调用量倒序堆叠(最大的在底)
                      const segments = Object.entries(d.by_model)
                        .sort((a, b) => b[1] - a[1])
                        .map(([m, c]) => ({
                          model: m,
                          count: c,
                          color: modelColor(m),
                        }));
                      return (
                        <div
                          key={d.date}
                          className="flex flex-col items-center"
                          title={`${d.date} · ${d.total.toLocaleString()} 次`}
                        >
                          {/* 总数标签 */}
                          <div
                            className={`mb-1 font-mono text-xs ${isToday ? 'font-bold text-purple-300' : d.total > 0 ? 'text-slate-300' : 'text-slate-700'
                              }`}
                          >
                            {d.total > 0 ? d.total.toLocaleString() : ''}
                          </div>
                          {/* 柱子容器(固定高度 + 底部对齐) */}
                          <div
                            className="relative flex w-full items-end justify-center overflow-hidden rounded-t-md"
                            style={{ height: `${MAX_BAR_PX}px` }}
                          >
                            {d.total === 0 ? (
                              <div
                                className="w-full bg-slate-800/60"
                                style={{ height: `${totalBarPx}px` }}
                              />
                            ) : (
                              <div
                                className={`flex w-full flex-col-reverse overflow-hidden ${isToday ? 'shadow-lg shadow-purple-500/40 ring-1 ring-purple-400/40' : ''
                                  }`}
                                style={{ height: `${totalBarPx}px` }}
                              >
                                {segments.map((seg, idx) => {
                                  const segH = (seg.count / d.total) * totalBarPx;
                                  return (
                                    <div
                                      key={seg.model}
                                      className="transition-all duration-500"
                                      style={{
                                        height: `${segH}px`,
                                        background: seg.color.bg,
                                        borderTop: idx > 0 ? '1px solid rgba(0,0,0,0.3)' : undefined,
                                      }}
                                      title={`${seg.model} · ${seg.count} 次`}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          {/* 日期标签 */}
                          <div
                            className={`mt-2 font-mono text-[10px] ${isToday ? 'font-semibold text-purple-300' : 'text-slate-500'
                              }`}
                          >
                            {isToday ? '今天' : d.date.slice(5)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 近 7 天模型 top 5 — 进度条风格 */}
            {usage.topModels7d && usage.topModels7d.length > 0 && (() => {
              const maxVal = Math.max(
                ...usage.topModels7d.map((m) => m.count),
                1
              );
              return (
                <div className="mt-3 rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500">
                    近 7 天模型调用 Top 5
                  </div>
                  <div className="mt-2.5 space-y-2">
                    {usage.topModels7d.map((m) => {
                      const pct = (m.count / maxVal) * 100;
                      return (
                        <div key={m.model} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 truncate font-mono text-xs text-slate-200" title={m.model}>
                            {m.model}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-400 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right font-mono text-xs text-slate-300">
                            {m.count.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* CC Switch 一键导入 — 所有套餐(category!=null)都显示 */}
        {(() => {
          const link = buildCcswitchDeeplink(data.category, data.api_key);
          if (!link) return null;
          const t = ccswitchBadgeText(data.category);
          return (
            <div className="mt-8 rounded-xl border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 to-teal-500/10 p-5 shadow-lg shadow-emerald-500/10">
              <div className="flex items-center gap-2 text-base font-semibold text-emerald-200">
                <Zap className="h-5 w-5 text-emerald-400" />
                {t.title}
                <span className="ml-auto rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
                  推荐 · 最简单
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-emerald-100/90">
                {t.desc}。<span className="font-medium text-emerald-300">无需手动复制 sk / 改 base URL</span>,自动写入正确的 config,避免 CC Switch 手动新建时的错位 bug。
              </p>

              {/* 3 步指引 */}
              <ol className="mt-3 space-y-1.5 text-xs text-emerald-100/90">
                <li className="flex gap-2">
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/30 text-[10px] font-bold text-emerald-200">1</span>
                  <span>点击下方绿色大按钮 → 浏览器弹窗问"是否打开 CC Switch?" → 点"<span className="font-semibold text-emerald-300">打开</span>"</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/30 text-[10px] font-bold text-emerald-200">2</span>
                  <span>CC Switch 如果弹"导入供应商"确认框,点"<span className="font-semibold text-emerald-300">确认</span>"(有些版本会自动导入无需确认)</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/30 text-[10px] font-bold text-emerald-200">3</span>
                  <span>回 terminal 重新跑命令即可 · CC Switch 已自动切换到 NassaAPI 供应商 + 写入正确的 config</span>
                </li>
              </ol>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={link}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/30 transition hover:bg-emerald-600 hover:shadow-lg"
                >
                  <Zap className="h-4 w-4" />
                  添加到 CC Switch 并启用
                </a>
                <span className="text-[10px] text-emerald-200/60">
                  需先安装 CC Switch v3.8+ · <a href="https://github.com/farion1231/cc-switch/releases/latest" target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">GitHub 下载</a>
                </span>
              </div>
            </div>
          );
        })()}

        {/* Codex CLI 命令配置 — 仅 GPT 套餐(DeepSeek 不支持 /v1/responses) */}
        {data.has_codex && (
          <div className="mt-4 rounded-xl border border-brand-500/30 bg-gradient-to-br from-brand-500/10 to-purple-500/10 p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <Zap className="h-4 w-4 text-brand-400" />
              备用 · 命令行直接配置 Codex CLI
              <span className="ml-auto text-xs font-normal text-slate-400">不用 CC Switch 时用</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              复制下方命令到终端粘贴执行,直接写入 ~/.codex/config.toml(同时清掉 CC Switch 错位污染)
            </p>

            {/* OS tab */}
            <div className="mt-3 inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-1">
              <button
                onClick={() => setOs('mac')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${os === 'mac' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-slate-100'
                  }`}
              >
                Mac / Linux
              </button>
              <button
                onClick={() => setOs('win')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${os === 'win' ? 'bg-brand-500 text-white' : 'text-slate-400 hover:text-slate-100'
                  }`}
              >
                Windows
              </button>
            </div>

            {/* 命令块 */}
            <div className="relative mt-3">
              <pre className="max-h-72 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 pr-20 font-mono text-xs leading-relaxed text-slate-300">
                {buildCodexCommand(os, data.api_key, origin)}
              </pre>
              <button
                onClick={() => copy(buildCodexCommand(os, data.api_key, origin), 'codex')}
                className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-600"
              >
                {copied === 'codex' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === 'codex' ? '已复制' : '复制'}
              </button>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-md border border-slate-700/60 bg-slate-900/50 p-3 text-xs text-slate-400">
              <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              <div>
                <span className="text-slate-300">还没装 Codex CLI?</span>{' '}
                {os === 'mac' ? (
                  <>
                    Mac 用户:<code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px]">npm install -g @openai/codex</code>
                  </>
                ) : (
                  <>
                    Windows 用户先装 <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-brand-400 underline">Node.js</a>,然后:
                    <code className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px]">npm install -g @openai/codex</code>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 使用示例 */}
        <details className="mt-6 rounded-xl border border-slate-700 bg-slate-900/40 p-5">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-300">
            <BookOpen className="h-4 w-4" />
            其他客户端使用方法
          </summary>
          <div className="mt-4 space-y-4 text-sm text-slate-300">
            {data.category === 'claude' ? (
              <>
                <div>
                  <div className="font-medium text-slate-100">Claude Code CLI</div>
                  <div className="mt-1 text-slate-400">
                    设置环境变量后直接 <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">claude</code> 即可:
                  </div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
                    {`export ANTHROPIC_BASE_URL="${data.base_url}"
export ANTHROPIC_API_KEY="${data.api_key}"
claude`}
                  </pre>
                </div>
                <div>
                  <div className="font-medium text-slate-100">curl 测试(Anthropic 协议)</div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
                    {`curl ${data.base_url}/v1/messages \\
  -H "x-api-key: ${data.api_key}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${data.models[0]}",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "你好"}]
  }'`}
                  </pre>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="font-medium text-slate-100">Cherry Studio / NextChat / Cursor / 其他客户端</div>
                  <div className="mt-1 text-slate-400">
                    添加自定义 OpenAI 提供商,填入 Base URL 和 API Key,模型名填右侧任意一个即可。
                  </div>
                </div>
                <div>
                  <div className="font-medium text-slate-100">curl 测试(OpenAI 协议)</div>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
                    {`curl ${data.base_url}/chat/completions \\
  -H "Authorization: Bearer ${data.api_key}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${data.models[0]}",
    "messages": [{"role": "user", "content": "你好"}]
  }'`}
                  </pre>
                </div>
              </>
            )}
          </div>
        </details>

        {/* ============== 一键续费 panel — 仅有期限的卡显示 ============== */}
        {!noExpire && data.category && (
          <div className="mt-8 rounded-2xl border-2 border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-amber-500/10 p-6 shadow-xl shadow-amber-500/5">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-500/20 p-2.5">
                <RotateCw className="h-5 w-5 text-amber-300" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-base font-bold text-amber-100">
                  觉得换 key 很麻烦?这里一键续费
                </div>
                <p className="mt-1 text-xs leading-relaxed text-amber-200/80">
                  原 sk-key <span className="font-mono">不变</span> · 时长直接叠加到当前到期时间 · {' '}
                  仅限<span className="font-semibold text-amber-200">同套餐</span>(
                  {data.category_label})卡密
                </p>
              </div>
            </div>

            {renewSuccess ? (
              <div className="mt-5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-2 text-base font-semibold text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  续费成功 · 新增 {formatDaysCN(renewSuccess.added_days)}
                </div>
                <div className="mt-3 space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-slate-400">原到期时间</span>
                    <span className="font-mono text-slate-300 line-through decoration-slate-500">
                      {new Date(renewSuccess.before_expires_at * 1000).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-slate-400">新到期时间</span>
                    <span className="font-mono text-emerald-300 font-semibold">
                      {new Date(renewSuccess.after_expires_at * 1000).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setRenewSuccess(null);
                    setRenewError(null);
                    setRenewCode('');
                  }}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  再续一次
                </button>
              </div>
            ) : (
              <form onSubmit={handleRenew} className="mt-5">
                <label className="block text-sm font-medium text-slate-300">
                  <KeyRound className="mr-1.5 inline h-4 w-4 text-amber-400" />
                  续费卡密
                </label>
                <input
                  type="text"
                  value={renewCode}
                  onChange={(e) => setRenewCode(e.target.value.toUpperCase())}
                  placeholder={`${data.category === 'deepseek' ? 'DE' : data.category === 'gpt' ? 'GP' : 'CL'}-XXXX-XXXX-XXXX`}
                  className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={renewLoading}
                />
                {renewError && (
                  <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {renewError}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={renewLoading || !renewCode}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/30 transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:shadow-none"
                  >
                    {renewLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在续费...
                      </>
                    ) : (
                      <>
                        <RotateCw className="h-4 w-4" />
                        立即续费
                      </>
                    )}
                  </button>
                  <a
                    href="https://pay.qxvx.cn/shop/codex"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-amber-300/80 hover:text-amber-200"
                  >
                    没有续费卡? 去店铺购买
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-amber-200/60">
                  时间叠加规则:仍在有效期 → 在原到期时间上 + N 天;已过期 → 从现在 + N 天复活。
                  续费卡用一次即作废,不可重复使用。
                </p>
              </form>
            )}
          </div>
        )}

        <div className="mt-8 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-300">
          ⚠ 卡密一经激活即开始计时。如需重新查看,可在首页重新输入同一卡密(到期前有效)。
        </div>
      </div>
    </main>
  );
}
