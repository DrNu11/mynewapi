'use client';

import { useState } from 'react';
import { Check, KeyRound, Link2, Loader2, UserRound } from 'lucide-react';

interface BindResult {
  code: string;
  status: string;
  newapi_user_id: number;
  token_migrated: boolean;
  logs_migrated: number;
}

export default function BindNewApiPage() {
  const [userId, setUserId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BindResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/bind-newapi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId.trim(), code: code.trim() }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '绑定失败');
        return;
      }
      setResult(body.data);
    } catch (e: any) {
      setError(e?.message || '网络错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-6 py-10">
        <form
          onSubmit={submit}
          className="w-full rounded-xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl"
        >
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-brand-400" />
            <h1 className="text-xl font-semibold text-slate-100">NewAPI 日志绑定</h1>
          </div>

          <label className="mt-6 block text-sm text-slate-300">
            <UserRound className="mr-1.5 inline h-4 w-4" />
            NewAPI 用户 ID
          </label>
          <input
            type="number"
            min={1}
            step={1}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="例如 444"
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />

          <label className="mt-4 block text-sm text-slate-300">
            <KeyRound className="mr-1.5 inline h-4 w-4" />
            DeepSeek 卡密
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="DE-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono tracking-wider text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {result && (
            <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-200">
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4" />
                已绑定到用户 {result.newapi_user_id}
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs text-emerald-100/80">
                <div>{result.code}</div>
                <div>status={result.status}</div>
                <div>token_migrated={String(result.token_migrated)}</div>
                <div>logs_migrated={result.logs_migrated}</div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !userId || !code}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-3 font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            绑定日志
          </button>
        </form>
      </div>
    </main>
  );
}
