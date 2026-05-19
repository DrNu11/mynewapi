'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS } from '@/lib/plans';
import { CATEGORIES, CATEGORY_LIST, type Category } from '@/lib/categories';
import {
  Plus,
  RefreshCcw,
  LogOut,
  Copy,
  Check,
  Loader2,
  KeyRound,
  Filter,
  Ban,
  Power,
} from 'lucide-react';

interface CardRow {
  id: number;
  code: string;
  plan: string;
  plan_days: number;
  category: string | null;
  rph: number;
  used_1h: number;
  status: 'unused' | 'activated' | 'expired' | 'disabled';
  created_at: number;
  activated_at: number | null;
  expires_at: number | null;
  newapi_token_key: string | null;
  notes: string | null;
}

interface Stats {
  total: number;
  unused: number;
  activated: number;
  expired: number;
  by_plan: Record<string, number>;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [cards, setCards] = useState<CardRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPlan, setFilterPlan] = useState<string>('');
  const [genPlan, setGenPlan] = useState<string>('1d');
  const [genCategory, setGenCategory] = useState<Category>('deepseek');
  const [genCount, setGenCount] = useState(10);
  const [genNotes, setGenNotes] = useState('');
  /** 自定义天数,留空(0)走 genPlan 套餐;1-3650 = 覆盖套餐天数 */
  const [genCustomDays, setGenCustomDays] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filterStatus) qs.set('status', filterStatus);
    if (filterPlan) qs.set('plan', filterPlan);
    qs.set('limit', '200');
    const res = await fetch(`/api/admin/cards?${qs}`);
    if (res.status === 401) {
      router.push('/admin/login');
      return;
    }
    const body = await res.json();
    if (body.success) {
      setCards(body.data.cards);
      setStats(body.data.stats);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [filterStatus, filterPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (genCount < 1) return;
    setGenerating(true);
    setNewCodes([]);
    try {
      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: genPlan,
          category: genCategory,
          count: genCount,
          notes: genNotes,
          // custom_days > 0 时后端用它覆盖 plan 的 days
          custom_days: genCustomDays > 0 ? genCustomDays : undefined,
        }),
      });
      const body = await res.json();
      if (body.success) {
        setNewCodes(body.data.codes);
        setGenNotes('');
        await load();
      } else {
        alert('生成失败: ' + body.message);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  function copyAll() {
    navigator.clipboard.writeText(newCodes.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  function copyRow(id: number, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedRow(id);
    setTimeout(() => setCopiedRow(null), 1500);
  }

  const fmtTime = (t: number | null) => (t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }) : '-');
  const categoryBadge = (c: string | null) => {
    if (!c) {
      return (
        <span className="rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-xs text-slate-400">
          legacy
        </span>
      );
    }
    const meta = (CATEGORIES as any)[c];
    if (!meta) return <span className="text-xs text-slate-400">{c}</span>;
    return (
      <span className={`rounded border px-2 py-0.5 text-xs ${meta.badgeClass}`}>
        {meta.shortLabel}
      </span>
    );
  };
  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      unused: 'bg-slate-700/60 text-slate-300 border-slate-600',
      activated: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      expired: 'bg-red-500/15 text-red-300 border-red-500/40',
      disabled: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    };
    const label: Record<string, string> = {
      unused: '未使用',
      activated: '已激活',
      expired: '已过期',
      disabled: '已禁用',
    };
    return (
      <span className={`rounded border px-2 py-0.5 text-xs ${map[s] || ''}`}>{label[s] || s}</span>
    );
  };

  async function toggleCard(card: CardRow) {
    const action = card.status === 'disabled' ? 'enable' : 'disable';
    const verb = action === 'disable' ? '禁用' : '取消禁用';
    if (!confirm(`确定${verb}卡密 ${card.code}?\n\n${action === 'disable' ? '客户的 sk-key 立即失效, NewAPI 同步禁用 token。可以再次取消禁用恢复。' : '恢复 NewAPI token, 客户 sk-key 重新可用。'}`)) return;
    setTogglingId(card.id);
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(card.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!body.success) {
        alert(`${verb}失败: ${body.message}`);
      } else {
        await load();
      }
    } catch (e: any) {
      alert(`${verb}失败: ${e?.message || e}`);
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">卡密管理</h1>
            <p className="mt-1 text-sm text-slate-400">生成、查看、追踪卡密使用情况</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/admin/audit')}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-sm text-purple-200 hover:bg-purple-500/20"
            >
              对话审计
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="总数" value={stats.total} />
            <StatCard label="未使用" value={stats.unused} highlight="brand" />
            <StatCard label="已激活" value={stats.activated} highlight="emerald" />
            <StatCard label="已过期" value={stats.expired} highlight="red" />
          </div>
        )}

        {/* 生成 */}
        <section className="mt-8 rounded-xl border border-slate-700 bg-slate-900/60 p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <Plus className="h-4 w-4 text-brand-400" />
            批量生成卡密
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-6">
            <div>
              <label className="text-xs text-slate-400">分类</label>
              <select
                value={genCategory}
                onChange={(e) => setGenCategory(e.target.value as Category)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              >
                {CATEGORY_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.prefix}-)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">套餐</label>
              <select
                value={genPlan}
                onChange={(e) => setGenPlan(e.target.value)}
                disabled={genCustomDays > 0}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none disabled:opacity-50"
              >
                {PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400" title="留空走套餐;填数字覆盖套餐天数(1-3650)">
                自定义天数
              </label>
              <input
                type="number"
                min={0}
                max={3650}
                value={genCustomDays || ''}
                onChange={(e) => setGenCustomDays(parseInt(e.target.value) || 0)}
                placeholder="留空=套餐"
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">数量</label>
              <input
                type="number"
                min={1}
                max={500}
                value={genCount}
                onChange={(e) => setGenCount(parseInt(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-400">备注(可选)</label>
              <input
                type="text"
                value={genNotes}
                onChange={(e) => setGenNotes(e.target.value)}
                placeholder="例如:渠道 A 批次"
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={generate}
            disabled={generating || genCount < 1}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:bg-slate-700"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            生成 {genCount} 个 ·{' '}
            {genCustomDays > 0 ? `${genCustomDays} 天` : PLANS.find((p) => p.id === genPlan)?.label || genPlan}
          </button>

          {newCodes.length > 0 && (
            <div className="mt-5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-emerald-300">
                  ✓ 已生成 {newCodes.length} 个新卡密
                </div>
                <button
                  onClick={copyAll}
                  className="flex items-center gap-1.5 rounded bg-emerald-500/20 px-3 py-1 text-xs text-emerald-300 hover:bg-emerald-500/30"
                >
                  {copiedAll ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedAll ? '已复制' : '一键全选复制'}
                </button>
              </div>
              <pre className="mt-3 max-h-48 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-300">
                {newCodes.join('\n')}
              </pre>
            </div>
          )}
        </section>

        {/* 列表 */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-slate-100">卡密列表</h2>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
              >
                <option value="">所有状态</option>
                <option value="unused">未使用</option>
                <option value="activated">已激活</option>
                <option value="expired">已过期</option>
                <option value="disabled">已禁用</option>
              </select>
              <select
                value={filterPlan}
                onChange={(e) => setFilterPlan(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
              >
                <option value="">所有套餐</option>
                {PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button
                onClick={load}
                className="rounded border border-slate-700 bg-slate-900 p-1.5 text-slate-400 hover:bg-slate-800"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-700 bg-slate-900/60 text-left text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">卡密</th>
                  <th className="px-3 py-2.5 font-medium">分类</th>
                  <th className="px-3 py-2.5 font-medium">套餐</th>
                  <th className="px-3 py-2.5 font-medium">状态</th>
                  <th className="px-3 py-2.5 font-medium">创建时间</th>
                  <th className="px-3 py-2.5 font-medium">激活时间</th>
                  <th className="px-3 py-2.5 font-medium">到期时间</th>
                  <th className="px-3 py-2.5 font-medium" title="近 1 小时请求数 / 每小时上限">RPH</th>
                  <th className="px-3 py-2.5 font-medium">备注</th>
                  <th className="px-3 py-2.5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 && !loading && (
                  <tr>
                    <td colSpan={10} className="px-3 py-12 text-center text-sm text-slate-500">
                      暂无数据
                    </td>
                  </tr>
                )}
                {cards.map((c) => (
                  <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-900/40">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{c.code}</td>
                    <td className="px-3 py-2.5">{categoryBadge(c.category)}</td>
                    <td className="px-3 py-2.5 text-slate-300">{c.plan_days}d</td>
                    <td className="px-3 py-2.5">{statusBadge(c.status)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtTime(c.created_at)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtTime(c.activated_at)}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{fmtTime(c.expires_at)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {c.rph === 0 ? (
                        <span className="text-slate-500">不限</span>
                      ) : (
                        <span
                          className={`font-mono ${c.used_1h >= c.rph
                            ? 'text-red-300'
                            : c.used_1h >= c.rph * 0.8
                              ? 'text-amber-300'
                              : 'text-slate-300'
                            }`}
                        >
                          {c.used_1h}/{c.rph}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{c.notes || '-'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => copyRow(c.id, c.code)}
                          className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                        >
                          {copiedRow === c.id ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          卡密
                        </button>
                        {c.newapi_token_key && (
                          <button
                            onClick={() => copyRow(c.id + 100000, c.newapi_token_key!)}
                            className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <KeyRound className="h-3 w-3" />
                            Key
                          </button>
                        )}
                        {c.status === 'activated' && (
                          <button
                            onClick={() => toggleCard(c)}
                            disabled={togglingId === c.id}
                            className="flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            title="禁用此卡 + 同步禁用 NewAPI token"
                          >
                            {togglingId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Ban className="h-3 w-3" />
                            )}
                            禁用
                          </button>
                        )}
                        {c.status === 'disabled' && (
                          <button
                            onClick={() => toggleCard(c)}
                            disabled={togglingId === c.id}
                            className="flex items-center gap-1 rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                            title="取消禁用此卡 + 同步启用 NewAPI token"
                          >
                            {togglingId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Power className="h-3 w-3" />
                            )}
                            取消禁用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: 'brand' | 'emerald' | 'red';
}) {
  const colors: Record<string, string> = {
    brand: 'text-brand-400',
    emerald: 'text-emerald-400',
    red: 'text-red-400',
  };
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/40 px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${highlight ? colors[highlight] : 'text-slate-100'}`}>
        {value}
      </div>
    </div>
  );
}
