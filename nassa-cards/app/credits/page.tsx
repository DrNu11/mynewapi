'use client';

import { useState } from 'react';
import {
  Sparkles,
  KeyRound,
  Loader2,
  Crown,
  Wallet,
  TrendingUp,
  Calendar,
  Infinity as InfinityIcon,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface DashboardData {
  code_masked: string;
  plan_label: string;
  activated_at: number | null;
  last_used_at: number | null;
  no_expire: boolean;
  total_usd: number;
  used_usd: number;
  remain_usd: number;
  usage_pct: number;
  status: 'enabled' | 'disabled';
}

function formatTime(unix: number | null): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
}

function formatUSD(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function GptProPage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  async function handleQuery(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setData(null);
    setLoading(true);
    try {
      const res = await fetch('/api/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '查询失败');
      } else {
        setData(body.data);
      }
    } catch (err: any) {
      setError(err?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-3xl px-6 pt-16 pb-24">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-1.5 text-sm text-purple-300">
            <Crown className="h-4 w-4" />
            GPT 周卡 / 尊享套餐 · 额度查询
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-50 sm:text-5xl">
            GPT 额度查询
          </h1>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            输入您的 GPT 周卡或尊享卡密,查询剩余额度与使用情况
          </p>
        </div>

        {/* 查询表单 */}
        <form
          onSubmit={handleQuery}
          className="mx-auto mt-10 max-w-xl rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur"
        >
          <label className="block text-sm font-medium text-slate-300">
            <KeyRound className="mr-1.5 inline h-4 w-4" />
            卡密
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="GP-XXXX-XXXX-XXXX"
            className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="mt-2 text-xs text-slate-500">
            仅 GPT 周卡(GP- 前缀,$1000 额度)与 GPT 尊享套餐($2000 额度)可查询
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-3 text-base font-medium text-white shadow-lg shadow-purple-500/30 transition hover:from-purple-500 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                查询中…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                查询额度
              </>
            )}
          </button>
        </form>

        {/* 结果 Dashboard */}
        {data && (
          <div className="mx-auto mt-8 max-w-xl space-y-4">
            {/* 卡密信息 */}
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">卡密</p>
                  <p className="mt-1 font-mono text-lg text-slate-100">{data.code_masked}</p>
                </div>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${data.status === 'enabled'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                    }`}
                >
                  {data.status === 'enabled' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      可用
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5" />
                      已禁用
                    </>
                  )}
                </span>
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/10 px-3 py-1 text-xs text-purple-300">
                <Crown className="h-3.5 w-3.5" />
                {data.plan_label}
              </div>
            </div>

            {/* 额度环 */}
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-300">
                  <Wallet className="mr-1.5 inline h-4 w-4" />
                  额度使用情况
                </p>
                <span className="text-xs text-slate-500">{data.usage_pct.toFixed(2)}% 已用</span>
              </div>

              {/* 进度条 */}
              <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-500 via-purple-400 to-fuchsia-400 transition-all duration-700"
                  style={{ width: `${Math.max(2, data.usage_pct)}%` }}
                />
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-slate-500">总额</p>
                  <p className="mt-1 text-lg font-semibold text-slate-100">
                    {formatUSD(data.total_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">已用</p>
                  <p className="mt-1 text-lg font-semibold text-amber-300">
                    {formatUSD(data.used_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">剩余</p>
                  <p className="mt-1 text-lg font-semibold text-emerald-300">
                    {formatUSD(data.remain_usd)}
                  </p>
                </div>
              </div>
            </div>

            {/* 时间信息 */}
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-xl backdrop-blur">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    <Calendar className="mr-1 inline h-3.5 w-3.5" />
                    激活时间
                  </p>
                  <p className="mt-1 text-sm text-slate-100">{formatTime(data.activated_at)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
                    最近使用
                  </p>
                  <p className="mt-1 text-sm text-slate-100">{formatTime(data.last_used_at)}</p>
                </div>
              </div>
              {data.no_expire && (
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                  <InfinityIcon className="h-3.5 w-3.5" />
                  永不过期 · 仅受额度约束
                </div>
              )}
            </div>

            <p className="text-center text-xs text-slate-500">
              数据来源:NewAPI 实时统计 · 1 美元 = 500,000 quota
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
