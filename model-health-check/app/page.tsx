'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MODELS, type ModelDef } from '@/lib/models';

interface CheckResult {
  modelId: string;
  status: 'ok' | 'fail' | 'pending';
  elapsedMs?: number;
  httpStatus?: number;
  error?: string;
  reply?: string;
  actualModel?: string;
  checkedAt?: number;
}

const STORAGE_KEY = 'nassa-hc-settings';
const DEFAULT_BASE = 'https://api.nassaapi.xyz/v1';

export default function Page() {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [filter, setFilter] = useState<'all' | 'ok' | 'fail'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    new Set(MODELS.map((m) => m.category)).forEach((c) => {
      init[c] = true;
    });
    return init;
  });
  const [checkingCategory, setCheckingCategory] = useState<string | null>(null);

  // 从 localStorage 恢复
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.baseUrl) setBaseUrl(parsed.baseUrl);
        if (parsed.apiKey) setApiKey(parsed.apiKey);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // 保存到 localStorage
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl, apiKey }));
    } catch {
      /* ignore */
    }
  }, [baseUrl, apiKey, hydrated]);

  const categories = useMemo(() => {
    const set = new Set(MODELS.map((m) => m.category));
    return ['all', ...Array.from(set)];
  }, []);

  const filteredModels = useMemo(() => {
    return MODELS.filter((m) => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      const r = results[m.id];
      if (filter === 'ok' && r?.status !== 'ok') return false;
      if (filter === 'fail' && r?.status !== 'fail') return false;
      return true;
    });
  }, [filter, categoryFilter, results]);

  // 按 category 分组（保留 lib/models.ts 里的顺序）
  const groupedModels = useMemo(() => {
    const map = new Map<string, ModelDef[]>();
    for (const m of filteredModels) {
      if (!map.has(m.category)) map.set(m.category, []);
      map.get(m.category)!.push(m);
    }
    return Array.from(map.entries());
  }, [filteredModels]);

  // 每个分类的小统计
  const categoryStats = useMemo(() => {
    const map: Record<
      string,
      { ok: number; fail: number; pending: number; untested: number; total: number }
    > = {};
    for (const m of MODELS) {
      const cat = m.category;
      if (!map[cat]) map[cat] = { ok: 0, fail: 0, pending: 0, untested: 0, total: 0 };
      map[cat].total++;
      const r = results[m.id];
      if (!r) map[cat].untested++;
      else if (r.status === 'ok') map[cat].ok++;
      else if (r.status === 'fail') map[cat].fail++;
      else map[cat].pending++;
    }
    return map;
  }, [results]);

  const stats = useMemo(() => {
    const vals = Object.values(results);
    const tested = vals.filter((r) => r.status !== 'pending').length;
    const ok = vals.filter((r) => r.status === 'ok').length;
    const fail = vals.filter((r) => r.status === 'fail').length;
    const avgLatency = vals
      .filter((r) => r.status === 'ok' && r.elapsedMs !== undefined)
      .reduce((sum, r, _, arr) => sum + (r.elapsedMs || 0) / arr.length, 0);
    return { tested, ok, fail, total: MODELS.length, avgLatency: Math.round(avgLatency) };
  }, [results]);

  const checkOne = useCallback(
    async (model: ModelDef) => {
      setResults((prev) => ({
        ...prev,
        [model.id]: { modelId: model.id, status: 'pending' },
      }));
      try {
        const resp = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: model.id, baseUrl, apiKey }),
        });
        const data: CheckResult = await resp.json();
        setResults((prev) => ({
          ...prev,
          [model.id]: { ...data, checkedAt: Date.now() },
        }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setResults((prev) => ({
          ...prev,
          [model.id]: {
            modelId: model.id,
            status: 'fail',
            error: msg,
            checkedAt: Date.now(),
          },
        }));
      }
    },
    [baseUrl, apiKey]
  );

  const checkAll = useCallback(async () => {
    if (checkingAll) return;
    setCheckingAll(true);
    // 并发，但限制为 4 个避免一次性打爆
    const queue = [...MODELS];
    const workers = Array.from({ length: 4 }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await checkOne(next);
      }
    });
    await Promise.all(workers);
    setCheckingAll(false);
  }, [checkOne, checkingAll]);

  const checkCategory = useCallback(
    async (category: string, models: ModelDef[]) => {
      setCheckingCategory(category);
      const queue = [...models];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (next) await checkOne(next);
        }
      });
      await Promise.all(workers);
      setCheckingCategory(null);
    },
    [checkOne]
  );

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCats((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const toggleAllCategories = useCallback((expand: boolean) => {
    const next: Record<string, boolean> = {};
    new Set(MODELS.map((m) => m.category)).forEach((c) => {
      next[c] = expand;
    });
    setExpandedCats(next);
  }, []);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || !apiKey) return;
    const timer = setInterval(() => {
      checkAll();
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval, apiKey, checkAll]);

  return (
    <main className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <span>🩺</span> 模型健康检查
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Nassa API 模型状态监控 · 实时观测每个模型的可用性与延迟
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 rounded-md text-sm transition"
            >
              ⚙️ 设置
            </button>
            <button
              onClick={checkAll}
              disabled={checkingAll || !apiKey}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed rounded-md text-sm font-medium transition"
            >
              {checkingAll ? '🔄 检测中...' : '🚀 全部检测'}
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3 mb-4">
            <div>
              <label className="block text-xs text-slate-700 mb-1">API Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">
                API Key{' '}
                <span className="text-slate-500">
                  (仅存在浏览器本地 localStorage，不会上传到远程)
                </span>
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-white border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="accent-emerald-100"
                />
                自动刷新间隔
              </label>
              <input
                type="number"
                min={10}
                max={600}
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(parseInt(e.target.value) || 30)}
                className="w-20 bg-white border border-slate-200 rounded px-2 py-1 text-sm"
              />
              <span className="text-sm">秒</span>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatBadge label="总计" value={stats.total} color="slate" />
          <StatBadge label="已测试" value={stats.tested} color="blue" />
          <StatBadge label="健康" value={stats.ok} color="emerald" />
          <StatBadge label="故障" value={stats.fail} color="red" />
          <StatBadge
            label="平均延迟"
            value={stats.avgLatency > 0 ? `${stats.avgLatency}ms` : '-'}
            color="amber"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-slate-500">状态:</span>
          {(['all', 'ok', 'fail'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded text-xs transition ${filter === f
                ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
            >
              {f === 'all' ? '全部' : f === 'ok' ? '✅ 健康' : '❌ 故障'}
            </button>
          ))}
          <span className="text-xs text-slate-500 ml-4">类别:</span>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-3 py-1 rounded text-xs transition ${categoryFilter === c
                ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
            >
              {c === 'all' ? '全部' : c}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => toggleAllCategories(true)}
              className="px-3 py-1 rounded text-xs bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
              title="展开所有分组"
            >
              ▼ 全部展开
            </button>
            <button
              onClick={() => toggleAllCategories(false)}
              className="px-3 py-1 rounded text-xs bg-slate-50 text-slate-700 hover:bg-slate-100 transition"
              title="折叠所有分组"
            >
              ▲ 全部折叠
            </button>
          </div>
        </div>
      </header>

      {!apiKey && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-300 rounded text-yellow-800 text-sm">
          ⚠️ 请先点右上角 <strong>设置</strong> 填入 API Key 才能开始检测
        </div>
      )}

      {/* 分组可折叠区域 */}
      <div className="space-y-3">
        {groupedModels.map(([category, models]) => (
          <CategorySection
            key={category}
            category={category}
            models={models}
            stats={categoryStats[category]}
            expanded={expandedCats[category] !== false}
            onToggle={() => toggleCategory(category)}
            onCheckCategory={() => checkCategory(category, models)}
            isChecking={checkingCategory === category}
            isAnyChecking={checkingAll || checkingCategory !== null}
            results={results}
            onCheckOne={checkOne}
            apiKey={apiKey}
          />
        ))}
      </div>

      {groupedModels.length === 0 && (
        <div className="text-center py-12 text-slate-500 text-sm">
          当前筛选下无模型
        </div>
      )}

      <footer className="mt-12 text-center text-slate-400 text-xs">
        模型清单在{' '}
        <code className="bg-slate-50 px-1.5 py-0.5 rounded font-mono">lib/models.ts</code>{' '}
        编辑 · 端口 <code className="bg-slate-50 px-1.5 py-0.5 rounded font-mono">3030</code>
      </footer>
    </main>
  );
}

// =================== 子组件 ===================

function StatBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: 'slate' | 'blue' | 'emerald' | 'red' | 'amber';
}) {
  const map = {
    slate: 'bg-slate-50 text-slate-900 border-slate-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-300',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    red: 'bg-red-50 text-red-700 border-red-300',
    amber: 'bg-amber-50 text-amber-700 border-amber-300',
  };
  return (
    <div className={`rounded-lg p-3 border ${map[color]}`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function CategorySection({
  category,
  models,
  stats,
  expanded,
  onToggle,
  onCheckCategory,
  isChecking,
  isAnyChecking,
  results,
  onCheckOne,
  apiKey,
}: {
  category: string;
  models: ModelDef[];
  stats?: { ok: number; fail: number; pending: number; untested: number; total: number };
  expanded: boolean;
  onToggle: () => void;
  onCheckCategory: () => void;
  isChecking: boolean;
  isAnyChecking: boolean;
  results: Record<string, CheckResult>;
  onCheckOne: (model: ModelDef) => Promise<void>;
  apiKey: string;
}) {
  const allTested = stats && stats.untested === 0;
  const headerBg =
    !stats || stats.untested === stats.total
      ? 'border-slate-200 bg-slate-50'
      : stats.fail > 0
        ? 'border-red-300 bg-red-50'
        : stats.ok === stats.total
          ? 'border-emerald-300 bg-emerald-50'
          : 'border-slate-200 bg-slate-50';

  return (
    <section className={`border rounded-lg overflow-hidden ${headerBg}`}>
      {/* Header */}
      <div
        onClick={onToggle}
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-100 transition select-none gap-3"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-slate-500 text-xs font-mono w-3">
            {expanded ? '▼' : '▶'}
          </span>
          <h2 className="text-base font-bold">{category}</h2>
          <span className="text-xs text-slate-500">{models.length} 个</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {stats && (
            <div className="flex items-center gap-2 text-xs">
              {stats.ok > 0 && <span className="text-emerald-700">✅ {stats.ok}</span>}
              {stats.fail > 0 && <span className="text-red-700">❌ {stats.fail}</span>}
              {stats.pending > 0 && (
                <span className="text-blue-700 animate-pulse">⏳ {stats.pending}</span>
              )}
              {stats.untested > 0 && (
                <span className="text-slate-500">○ {stats.untested}</span>
              )}
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckCategory();
            }}
            disabled={isAnyChecking || !apiKey}
            className="px-3 py-1 bg-white border border-slate-200 hover:bg-slate-100 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-medium transition whitespace-nowrap"
          >
            {isChecking ? '🔄 检测中' : '🔍 检测本组'}
          </button>
        </div>
      </div>

      {/* Body */}
      {expanded && (
        <div className="p-3 pt-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              result={results[model.id]}
              onCheck={() => onCheckOne(model)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModelCard({
  model,
  result,
  onCheck,
}: {
  model: ModelDef;
  result?: CheckResult;
  onCheck: () => void;
}) {
  const status = result?.status;
  const statusText =
    !status ? '未检测' : status === 'pending' ? '检测中' : status === 'ok' ? '健康' : '故障';

  const borderColor =
    status === 'ok'
      ? 'border-emerald-400'
      : status === 'fail'
        ? 'border-red-400'
        : status === 'pending'
          ? 'border-blue-300'
          : 'border-slate-200';

  const badgeColor =
    status === 'ok'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'fail'
        ? 'bg-red-100 text-red-700'
        : status === 'pending'
          ? 'bg-blue-100 text-blue-700 animate-pulse'
          : 'bg-slate-50 text-slate-500';

  const elapsed = result?.elapsedMs;
  const elapsedColor =
    elapsed === undefined
      ? 'text-slate-500'
      : elapsed < 1000
        ? 'text-emerald-700'
        : elapsed < 3000
          ? 'text-yellow-700'
          : 'text-orange-600';

  return (
    <div className={`bg-white border rounded-lg p-4 transition ${borderColor}`}>
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-sm font-semibold truncate" title={model.id}>
            {model.id}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {model.category}
            {model.note ? <span className="ml-1 text-slate-400">· {model.note}</span> : null}
          </div>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${badgeColor}`}
        >
          {statusText}
        </span>
      </div>

      {result && result.status !== 'pending' && (
        <div className="space-y-1 mt-3 text-xs">
          {elapsed !== undefined && (
            <div className="flex justify-between">
              <span className="text-slate-500">响应时间</span>
              <span className={elapsedColor + ' font-mono'}>{elapsed}ms</span>
            </div>
          )}
          {result.httpStatus !== undefined && (
            <div className="flex justify-between">
              <span className="text-slate-500">HTTP</span>
              <span
                className={
                  result.httpStatus < 300
                    ? 'text-emerald-700 font-mono'
                    : 'text-red-700 font-mono'
                }
              >
                {result.httpStatus}
              </span>
            </div>
          )}
          {result.actualModel && result.actualModel !== model.id && (
            <div className="flex justify-between">
              <span className="text-slate-500">实际</span>
              <span className="text-yellow-700 font-mono truncate max-w-[60%]">
                {result.actualModel}
              </span>
            </div>
          )}
          {result.reply && (
            <div className="mt-2 p-2 bg-slate-50 rounded text-slate-900 break-words border border-slate-200">
              💬 {result.reply}
            </div>
          )}
          {result.error && (
            <div className="mt-2 p-2 bg-red-50 border border-red-300 rounded text-red-700 break-words">
              ❌ {result.error}
            </div>
          )}
          {result.checkedAt && (
            <div className="text-slate-400 text-[10px] mt-2 text-right">
              {new Date(result.checkedAt).toLocaleTimeString('zh-CN')}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onCheck}
        disabled={status === 'pending'}
        className="mt-3 w-full px-3 py-1.5 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed rounded text-xs font-medium transition"
      >
        {status === 'pending' ? '检测中...' : '立即检测'}
      </button>
    </div>
  );
}
