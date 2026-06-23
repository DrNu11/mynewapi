'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Loader2 } from 'lucide-react';

export default function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || '登录失败');
        setLoading(false);
        return;
      }
      router.push('/admin');
    } catch (err: any) {
      setError(err.message || '网络错误');
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900/60 p-7 shadow-2xl backdrop-blur"
      >
        <div className="flex items-center gap-2 text-slate-100">
          <Lock className="h-5 w-5 text-brand-400" />
          <h1 className="text-xl font-semibold">管理员登录</h1>
        </div>
        <p className="mt-1 text-xs text-slate-500">仅限内部人员</p>

        <label className="mt-6 block text-sm text-slate-300">用户名</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />

        <label className="mt-4 block text-sm text-slate-300">密码</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 font-medium text-white hover:bg-brand-600 disabled:bg-slate-700"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          登录
        </button>
      </form>
    </main>
  );
}
