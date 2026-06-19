'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS } from '@/lib/plans';
import type { Plan } from '@/lib/plans';
import { CATEGORY_LIST } from '@/lib/categories';
import type { CategoryMeta } from '@/lib/categories';
import { Sparkles, KeyRound, Loader2, ShieldCheck, Zap, ShoppingCart } from 'lucide-react';

function planDescriptionForCategory(cat: CategoryMeta, plan: Plan): string {
  if (cat.id === 'gpt' && plan.id === '7d') {
    return '一周高强度使用,$1000 额度跑满为止';
  }
  return plan.description;
}

export default function HomePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingCache, setCheckingCache] = useState(true);
  const router = useRouter();

  // 页面加载时检查本地缓存，有未过期的 key 直接跳 result
  useEffect(() => {
    try {
      // 用户从结果页点"返回"过来（带 stay=1），不自动跳回 result，停在首页
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('stay') === '1') {
        setCheckingCache(false);
        return;
      }
      const raw = localStorage.getItem('nc_cache');
      if (!raw) { setCheckingCache(false); return; }
      const cached = JSON.parse(raw);
      if (!cached?.api_key) { setCheckingCache(false); return; }
      // 检查是否已过期
      if (cached.expires_at && cached.expires_at * 1000 < Date.now()) {
        localStorage.removeItem('nc_cache');
        localStorage.removeItem('nc_cache_code');
        setCheckingCache(false);
        return;
      }
      sessionStorage.setItem('nc_result', raw);
      sessionStorage.setItem('nc_already', '1');
      router.replace('/result');
    } catch {
      setCheckingCache(false);
    }
  }, [router]);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '激活失败');
        setLoading(false);
        return;
      }
      // 写入 sessionStorage（当前页面跳转用）
      sessionStorage.setItem('nc_result', JSON.stringify(body.data));
      sessionStorage.setItem('nc_already', body.already_activated ? '1' : '0');
      // 写入 localStorage（跨浏览器会话持久化）
      localStorage.setItem('nc_cache', JSON.stringify(body.data));
      localStorage.setItem('nc_cache_code', code.trim());
      router.push('/result');
    } catch (err: any) {
      setError(err.message || '网络错误');
      setLoading(false);
    }
  }

  if (checkingCache) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400">
            <Sparkles className="h-4 w-4" />
            DeepSeek / GPT 两套餐任选
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            输入卡密 · 即刻开通
          </h1>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            激活后获得专属 API Key,可在 Cherry Studio / Claude Code / Cursor 等任意工具中使用
          </p>
        </div>

        {/* 激活 / 购买 双栏 */}
        <div className="mx-auto mt-12 grid max-w-4xl gap-6 lg:grid-cols-2">
          {/* 激活卡 */}
          <form
            onSubmit={handleRedeem}
            className="rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur"
          >
            <label className="block text-sm font-medium text-slate-300">
              <KeyRound className="mr-1.5 inline h-4 w-4" />
              卡密
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={`${CATEGORY_LIST.map((c) => c.prefix).join(' / ')}- XXXX-XXXX-XXXX`}
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {CATEGORY_LIST.map((c) => (
                <span key={c.id}>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${c.badgeClass}`}
                  >
                    {c.prefix}-
                  </span>{' '}
                  {c.label}
                </span>
              ))}
            </p>
            {error && (
              <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !code}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在开通...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  立即激活
                </>
              )}
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">
              激活后可重新输入同一卡密查看 API Key,直到到期。关闭浏览器后重新打开无需再次输入。
            </p>
          </form>

          {/* 购买卡 */}
          <a
            href="https://pay.qxvx.cn/shop/codex"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col justify-between rounded-2xl border border-slate-700 bg-slate-900/60 p-6 shadow-2xl backdrop-blur transition hover:border-emerald-500/60"
          >
            <div>
              <div className="flex items-center gap-2 text-emerald-400">
                <ShoppingCart className="h-4 w-4" />
                <span className="text-sm font-medium">还没有卡密?</span>
              </div>
              <h3 className="mt-3 text-2xl font-bold text-slate-100">立即购买卡密</h3>
              <p className="mt-2 text-sm text-slate-400">
                跳转自动发卡店铺,支付宝 / 微信扫码付款,卡密自动到手,回本页粘贴激活即可使用。
              </p>
            </div>
            <div className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 font-medium text-white transition group-hover:bg-emerald-600">
              <ShoppingCart className="h-4 w-4" />
              前往购买店铺
              <span aria-hidden="true">→</span>
            </div>
          </a>
        </div>

        {/* 套餐展示 */}
        <div className="mt-16 space-y-12">
          {CATEGORY_LIST.map((cat) => (
            <div key={cat.id}>
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-2xl font-semibold text-slate-100">{cat.label}</h2>
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-xs ${cat.badgeClass}`}
                >
                  {cat.prefix}-XXXX-XXXX-XXXX
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-400">{cat.description}</p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                {PLANS.filter((p) => !p.internal).map((plan) => (
                  <div
                    key={`${cat.id}-${plan.id}`}
                    className="rounded-xl border border-slate-700 bg-slate-900/40 p-6 transition hover:border-brand-500/50"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-lg font-semibold text-slate-100">{plan.label}</span>
                      <span className="font-mono text-xs text-slate-500">{plan.days}d</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{planDescriptionForCategory(cat, plan)}</p>
                    <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
                      {cat.defaultModels.split(',').map((m) => (
                        <li key={m} className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-brand-400" />
                          <span className="font-mono text-xs">{m.trim()}</span>
                        </li>
                      ))}
                      {cat.hasCodex && (
                        <li className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-brand-400" />
                          <span>一键配置 Codex CLI</span>
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <footer className="mt-16 text-center text-xs text-slate-600">
          {new Date().getFullYear()} NassaAPI · 卡密激活中心
        </footer>
      </div>
    </main>
  );
}
