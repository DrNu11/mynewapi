'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS, formatDaysCN } from '@/lib/plans';
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
  Search,
  X,
  Ban,
  Power,
  FolderTree,
  UserRound,
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
  newapi_user_id: number | null;
  disable_reason: string | null;
  notes: string | null;
  pool: string | null;
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
  const [pools, setPools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPlan, setFilterPlan] = useState<string>('');
  const [filterPool, setFilterPool] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [genPlan, setGenPlan] = useState<string>('1d');
  const [genCategory, setGenCategory] = useState<Category>('deepseek');
  const [genCount, setGenCount] = useState(1);
  const [genNotes, setGenNotes] = useState('');
  const [genPool, setGenPool] = useState('');
  const [genNewApiUserId, setGenNewApiUserId] = useState('');
  const [poolEditingId, setPoolEditingId] = useState<number | null>(null);
  const [userEditingId, setUserEditingId] = useState<number | null>(null);
  /**
   * 自定义天数: 存原始 input 字符串(避免 React 受控 input 在 0/小数开头时被清空)。
   * 留空 → 走 genPlan 套餐；填数字(>= MIN_CUSTOM_DAYS) → 覆盖套餐天数。
   */
  const [genCustomDays, setGenCustomDays] = useState<string>('');
  const customDaysNum = parseFloat(genCustomDays);
  const customDaysActive = Number.isFinite(customDaysNum) && customDaysNum > 0;
  const [generating, setGenerating] = useState(false);
  const [newCodes, setNewCodes] = useState<string[]>([]);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedRow, setCopiedRow] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [tab, setTab] = useState<'cards' | 'invites'>('cards');

  // invite review state
  interface InviteRedemption {
    id: number;
    attribution_id: number;
    invite_link_id: number;
    inviter_card_id: number;
    invitee_card_id: number;
    qualifying_video_task_id: number;
    reward_status: string;
    business_date: string;
    risk_flags: string | null;
    rejected_reason: string | null;
    created_at: number;
    granted_at: number | null;
    updated_at: number;
    inviter_code: string;
    inviter_status: string;
    inviter_video_bonus_quota: number;
    invitee_code: string;
    invitee_status: string;
    invite_code: string;
    video_task_id: string;
    video_status: string;
    attr_outcome: string | null;
    invitee_ip_hash: string | null;
    invitee_device_hash: string | null;
    creator_ip_hash: string | null;
    creator_device_hash: string | null;
  }
  const [invites, setInvites] = useState<InviteRedemption[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (filterStatus) qs.set('status', filterStatus);
    if (filterPlan) qs.set('plan', filterPlan);
    if (filterPool) qs.set('pool', filterPool);
    if (debouncedQuery) qs.set('q', debouncedQuery);
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
      setPools(body.data.pools || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [filterStatus, filterPlan, filterPool, debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // 300ms debounce: 用户输入 searchQuery -> 延迟更新 debouncedQuery 触发 load
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

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
          pool: genPool.trim() || undefined,
          newapi_user_id: genNewApiUserId.trim() || undefined,
          // custom_days > 0 时后端用它覆盖 plan 的 days
          custom_days: customDaysActive ? customDaysNum : undefined,
        }),
      });
      const body = await res.json();
      if (body.success) {
        setNewCodes(body.data.codes);
        setGenNotes('');
        setGenNewApiUserId('');
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

  async function setPool(card: CardRow) {
    const current = card.pool || '';
    const next = window.prompt(
      `修改卡密 ${card.code} 的归属号池\n(留空 = 清除归属、最多 64 字符、商家仅可见)`,
      current
    );
    if (next === null) return; // 取消
    const v = next.trim();
    if (v === current) return; // 未变
    setPoolEditingId(card.id);
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(card.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_pool', pool: v }),
      });
      const body = await res.json();
      if (!body.success) {
        alert(`修改归属失败: ${body.message}`);
      } else {
        await load();
      }
    } catch (e: any) {
      alert(`修改归属失败: ${e?.message || e}`);
    } finally {
      setPoolEditingId(null);
    }
  }

  async function setNewApiUser(card: CardRow) {
    const current = card.newapi_user_id ? String(card.newapi_user_id) : '';
    const suffix = card.newapi_token_key
      ? '\n\n注意:这张卡已经激活,这里只更新后台标注,不会迁移 NewAPI 既有 token 和历史日志。'
      : '\n\n未激活卡设置后,客户激活时 token 会创建到该 NewAPI 用户名下。';
    const next = window.prompt(
      `修改卡密 ${card.code} 的 NewAPI 用户 ID\n(留空 = 使用默认管理员归属)${suffix}`,
      current
    );
    if (next === null) return;
    const v = next.trim();
    if (v === current) return;
    if (v && (!/^\d+$/.test(v) || Number(v) <= 0)) {
      alert('NewAPI 用户 ID 必须是正整数');
      return;
    }
    setUserEditingId(card.id);
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(card.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_newapi_user_id', newapi_user_id: v || null }),
      });
      const body = await res.json();
      if (!body.success) {
        alert(`修改 NewAPI 用户失败: ${body.message}`);
      } else {
        if (body.data?.warning) alert(body.data.warning);
        await load();
      }
    } catch (e: any) {
      alert(`修改 NewAPI 用户失败: ${e?.message || e}`);
    } finally {
      setUserEditingId(null);
    }
  }

  async function toggleCard(card: CardRow) {
    const action = card.status === 'disabled' ? 'enable' : 'disable';
    const verb = action === 'disable' ? '禁用' : '取消禁用';
    const hasToken = Boolean(card.newapi_token_key);
    const detail =
      action === 'disable'
        ? hasToken
          ? '客户的 sk-key 立即失效, NewAPI 同步禁用 token。可以再次取消禁用恢复。'
          : '这张卡密尚未激活,禁用后客户将无法激活。可以再次取消禁用恢复为未使用。'
        : hasToken
          ? '恢复 NewAPI token, 客户 sk-key 重新可用。'
          : '这张卡密尚未激活,取消禁用后恢复为未使用,客户可以继续激活。';
    let disableReason = '';
    if (action === 'disable') {
      const next = window.prompt(
        `确定禁用卡密 ${card.code}?\n\n${detail}\n\n请输入客户请求时看到的禁用理由:`,
        card.disable_reason || '该卡密因异常并发/滥用已被暂停使用,请联系客服处理。'
      );
      if (next === null) return;
      disableReason = next.trim();
      if (!disableReason) {
        alert('禁用理由不能为空');
        return;
      }
    } else if (!confirm(`确定${verb}卡密 ${card.code}?\n\n${detail}`)) {
      return;
    }
    setTogglingId(card.id);
    try {
      const res = await fetch(`/api/admin/cards/${encodeURIComponent(card.code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, disable_reason: disableReason || undefined }),
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

  async function loadInvites() {
    setInvitesLoading(true);
    try {
      const res = await fetch('/api/admin/invites?status=pending_review&limit=50');
      if (res.status === 401) {
        router.push('/admin/login');
        return;
      }
      const body = await res.json();
      if (body.success) setInvites(body.data);
    } finally {
      setInvitesLoading(false);
    }
  }

  async function approveInvite(id: number) {
    setActionId(id);
    try {
      const res = await fetch(`/api/admin/invites/${id}/approve`, { method: 'POST' });
      const body = await res.json();
      if (!body.success) alert(body.message);
      await loadInvites();
    } finally {
      setActionId(null);
    }
  }

  async function rejectInvite(id: number) {
    setActionId(id);
    try {
      const res = await fetch(`/api/admin/invites/${id}/reject`, { method: 'POST' });
      const body = await res.json();
      if (!body.success) alert(body.message);
      await loadInvites();
    } finally {
      setActionId(null);
    }
  }

  async function reverseInvite(id: number) {
    setActionId(id);
    try {
      const res = await fetch(`/api/admin/invites/${id}/reverse`, { method: 'POST' });
      const body = await res.json();
      if (!body.success) alert(body.message);
      await loadInvites();
    } finally {
      setActionId(null);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100">管理后台</h1>
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

        {/* Tabs */}
        <div className="mt-6 flex gap-2 border-b border-slate-700 pb-0">
          <button
            onClick={() => setTab('cards')}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === 'cards'
                ? 'border-b-2 border-brand-500 text-brand-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            卡密管理
          </button>
          <button
            onClick={() => { setTab('invites'); loadInvites(); }}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === 'invites'
                ? 'border-b-2 border-brand-500 text-brand-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            邀请审核
          </button>
        </div>

        {tab === 'cards' && (
          <>
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
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-7">
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
                disabled={customDaysActive}
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
              <label className="text-xs text-slate-400" title="留空走套餐;填数字覆盖套餐天数(支持小数，如 0.5=12 小时、0.25=6 小时)">
                自定义天数 (可填小数)
              </label>
              <input
                type="number"
                min={0}
                max={3650}
                step={0.5}
                value={genCustomDays}
                onChange={(e) => setGenCustomDays(e.target.value)}
                placeholder="留空=套餐 / 0.5=12h"
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
            <div>
              <label className="text-xs text-slate-400" title="填写客户在 NewAPI 后台的用户 ID;激活时 token 会创建到该用户名下">
                <UserRound className="mr-1 inline h-3 w-3" />
                NewAPI 用户ID(可选)
              </label>
              <input
                type="number"
                min={1}
                step={1}
                value={genNewApiUserId}
                onChange={(e) => setGenNewApiUserId(e.target.value)}
                placeholder="例如:444"
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400" title="运营标签:号池/批次名,仅管理员可见,客户进入什么都看不到">
                <FolderTree className="mr-1 inline h-3 w-3" />
                号池(可选,仅商家可见)
              </label>
              <input
                type="text"
                value={genPool}
                onChange={(e) => setGenPool(e.target.value)}
                placeholder="例如:pro 号池"
                maxLength={64}
                list="pool-suggest"
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
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
          {/* 在表单外公用 pool datalist,生成输入 + 后续按钮都能联动 */}
          <datalist id="pool-suggest">
            {pools.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <button
            onClick={generate}
            disabled={generating || genCount < 1}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:bg-slate-700"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            生成 {genCount} 个 ·{' '}
            {customDaysActive ? formatDaysCN(customDaysNum) : PLANS.find((p) => p.id === genPlan)?.label || genPlan}
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
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索卡密/备注/sk-key"
                  className="w-56 rounded border border-slate-700 bg-slate-900 py-1 pl-7 pr-7 text-xs text-slate-200 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    title="清空搜索"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
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
              <select
                value={filterPool}
                onChange={(e) => setFilterPool(e.target.value)}
                title="号池(运营归属标签),仅管理员可见"
                className="rounded border border-purple-500/40 bg-purple-500/10 px-2 py-1 text-xs text-purple-200"
              >
                <option value="">所有号池</option>
                <option value="__none__">未归属</option>
                {pools.map((p) => (
                  <option key={p} value={p}>
                    {p}
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
                  <th className="px-3 py-2.5 font-medium" title="商家内部号池标签">号池</th>
                  <th className="px-3 py-2.5 font-medium" title="激活时 token 归属的 NewAPI 用户">NewAPI用户</th>
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
                    <td colSpan={12} className="px-3 py-12 text-center text-sm text-slate-500">
                      暂无数据
                    </td>
                  </tr>
                )}
                {cards.map((c) => (
                  <tr key={c.id} className="border-b border-slate-800 hover:bg-slate-900/40">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{c.code}</td>
                    <td className="px-3 py-2.5">{categoryBadge(c.category)}</td>
                    <td className="px-3 py-2.5">
                      {c.pool ? (
                        <span className="rounded border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-200">
                          {c.pool}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {c.newapi_user_id ? (
                        <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 font-mono text-xs text-sky-200">
                          {c.newapi_user_id}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">默认</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{formatDaysCN(c.plan_days)}</td>
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
                        <button
                          onClick={() => setPool(c)}
                          disabled={poolEditingId === c.id}
                          title="修改运营号池归属(仅商家可见)"
                          className="flex items-center gap-1 rounded border border-purple-500/40 px-2 py-1 text-xs text-purple-300 hover:bg-purple-500/10 disabled:opacity-50"
                        >
                          {poolEditingId === c.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <FolderTree className="h-3 w-3" />
                          )}
                          号池
                        </button>
                        <button
                          onClick={() => setNewApiUser(c)}
                          disabled={userEditingId === c.id}
                          title="设置 token 归属的 NewAPI 用户 ID"
                          className="flex items-center gap-1 rounded border border-sky-500/40 px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                        >
                          {userEditingId === c.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <UserRound className="h-3 w-3" />
                          )}
                          用户
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
                        {(c.status === 'activated' || c.status === 'unused') && (
                          <button
                            onClick={() => toggleCard(c)}
                            disabled={togglingId === c.id}
                            className="flex items-center gap-1 rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            title={
                              c.newapi_token_key
                                ? '禁用此卡 + 同步禁用 NewAPI token'
                                : '禁用未激活卡密,阻止客户激活'
                            }
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
          </>
        )}

        {tab === 'invites' && (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-100">待审核邀请奖励</h2>
              <button
                onClick={loadInvites}
                disabled={invitesLoading}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                <RefreshCcw className={`h-3.5 w-3.5 ${invitesLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            {invitesLoading && invites.length === 0 ? (
              <div className="mt-4 flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : invites.length === 0 ? (
              <p className="mt-4 py-12 text-center text-sm text-slate-500">暂无待审核记录</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60 text-left text-xs text-slate-400">
                      <th className="px-4 py-2 font-medium">邀请人</th>
                      <th className="px-4 py-2 font-medium">被邀请人</th>
                      <th className="px-4 py-2 font-medium">邀请码</th>
                      <th className="px-4 py-2 font-medium">视频任务</th>
                      <th className="px-4 py-2 font-medium">风险</th>
                      <th className="px-4 py-2 font-medium">日期</th>
                      <th className="px-4 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((r) => (
                      <tr key={r.id} className="border-b border-slate-800 hover:bg-slate-900/40">
                        <td className="px-4 py-2">
                          <div className="font-mono text-xs text-slate-300">{r.inviter_code}</div>
                          <div className="text-xs text-slate-500">
                            {r.inviter_status} · 奖励额度 {r.inviter_video_bonus_quota}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="font-mono text-xs text-slate-300">{r.invitee_code}</div>
                          <div className="text-xs text-slate-500">{r.invitee_status}</div>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-400">{r.invite_code}</td>
                        <td className="px-4 py-2">
                          <div className="font-mono text-xs text-slate-300">{r.video_task_id?.slice(0, 12)}...</div>
                          <div className="text-xs text-slate-500">{r.video_status}</div>
                        </td>
                        <td className="px-4 py-2">
                          {r.risk_flags ? (
                            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">
                              {r.risk_flags}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{r.business_date}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => approveInvite(r.id)}
                              disabled={actionId === r.id}
                              className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              {actionId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : '批准'}
                            </button>
                            <button
                              onClick={() => rejectInvite(r.id)}
                              disabled={actionId === r.id}
                              className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                            >
                              {actionId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : '拒绝'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
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
