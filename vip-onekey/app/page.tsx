'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, KeyRound, Mail, Loader2, ShieldCheck, Zap, Crown } from 'lucide-react';

export default function HomePage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '激活失败');
        setLoading(false);
        return;
      }
      sessionStorage.setItem('vip_result', JSON.stringify(body.data));
      sessionStorage.setItem('vip_already', body.already_activated ? '1' : '0');
      router.push('/result');
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-24">
        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-sm text-brand-400">
            <Sparkles className="h-4 w-4" />
            VIP1 · 0.6 倍率 · 30 天有效
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            一键开通 VIP · 即刻生效
          </h1>
          <p className="mt-4 text-base text-slate-400 sm:text-lg">
            输入您在 NassaAPI 的注册邮箱与卡密,后端自动升级账号至 VIP1 分组
          </p>
        </div>

        {/* 激活表单 */}
        <div className="mx-auto mt-12 max-w-2xl">
          <form
            onSubmit={handleActivate}
            className="rounded-2xl border border-slate-700 bg-slate-900/60 p-7 shadow-2xl backdrop-blur"
          >
            {/* 邮箱 */}
            <label className="block text-sm font-medium text-slate-300">
              <Mail className="mr-1.5 inline h-4 w-4" />
              NassaAPI 注册邮箱
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />

            {/* 卡密 */}
            <label className="mt-5 block text-sm font-medium text-slate-300">
              <KeyRound className="mr-1.5 inline h-4 w-4" />
              VIP 卡密
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="VIP1-XXXX-XXXX-XXXX"
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-2 text-xs text-slate-500">
              <span className="rounded border border-brand-500/40 bg-brand-500/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-400">
                VIP1-
              </span>{' '}
              30 天 0.6 倍率分组
            </p>

            {error && (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !code}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在升级...
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4" />
                  立即开通 VIP
                </>
              )}
            </button>

            <p className="mt-3 text-center text-xs text-slate-500">
              已激活的卡密支持重新查询,可查看剩余到期时间
            </p>
          </form>
        </div>

        {/* 套餐展示 */}
        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-center text-2xl font-semibold text-slate-100">VIP1 权益</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-5">
              <div className="flex items-center gap-2 text-brand-400">
                <Zap className="h-4 w-4" />
                <span className="font-medium">0.6 倍率</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">所有模型按 0.6 折计费,长期高频使用更省</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-5">
              <div className="flex items-center gap-2 text-brand-400">
                <ShieldCheck className="h-4 w-4" />
                <span className="font-medium">30 天有效</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">从激活之时起 30 天,到期自动回退默认分组</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-5">
              <div className="flex items-center gap-2 text-brand-400">
                <Crown className="h-4 w-4" />
                <span className="font-medium">即时生效</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">点击后秒级升级,无需重新登录或重启工具</p>
            </div>
          </div>
        </div>

        <footer className="mt-16 text-center text-xs text-slate-600">
          {new Date().getFullYear()} NassaAPI · VIP 一键开通
        </footer>
      </div>
    </main>
  );
}
