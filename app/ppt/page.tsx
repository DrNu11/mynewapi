'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  KeyRound,
  Loader2,
  Presentation,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  PPT_DEFAULT_SLIDES,
  PPT_MAX_SLIDES,
  PPT_MIN_SLIDES,
  PPT_REQUEST_BASE_URL,
} from '@/lib/ppt/constants';
import { PPT_SCENARIOS, PPT_STYLES, PPT_TEMPLATES } from '@/lib/ppt/types';

type CachedResult = {
  api_key?: string;
  expires_at?: number | null;
};

type QuotaState = {
  quota: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
};

type TaskState = {
  taskId: string;
  status: string;
  downloadUrl: string | null;
  title: string;
};

function readCachedKey(): string {
  const stores: Array<Storage | null> = [
    typeof window !== 'undefined' ? sessionStorage : null,
    typeof window !== 'undefined' ? localStorage : null,
  ];
  for (const store of stores) {
    if (!store) continue;
    for (const key of ['nc_result', 'nc_cache']) {
      const raw = store.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as CachedResult;
        if (parsed.api_key && (!parsed.expires_at || parsed.expires_at * 1000 > Date.now())) {
          return parsed.api_key;
        }
      } catch {
        // ignore malformed cache
      }
    }
  }
  return '';
}

export default function PptPage() {
  const [apiKey, setApiKey] = useState('');
  const [title, setTitle] = useState('AI API SaaS 平台商业计划书');
  const [scenario, setScenario] = useState<string>(PPT_SCENARIOS[0]);
  const [style, setStyle] = useState<string>(PPT_STYLES[0]);
  const [templateId, setTemplateId] = useState<string>(PPT_TEMPLATES[0].id);
  const [slideCount, setSlideCount] = useState(PPT_DEFAULT_SLIDES);
  const [inputText, setInputText] = useState('目标用户、产品价值、核心功能、商业模式、落地计划、风险控制、阶段目标。');
  const [quota, setQuota] = useState<QuotaState | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<TaskState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const normalizedKey = apiKey.trim();
  const canSubmit = normalizedKey.startsWith('sk-') && title.trim() && inputText.trim().length >= 8 && !loading;
  const quotaText = useMemo(() => {
    if (!quota) return '未检查';
    if (quota.unlimited) return `不限次数 · 已生成 ${quota.used}`;
    return `剩余 ${quota.remaining} / ${quota.quota}`;
  }, [quota]);

  useEffect(() => {
    const cached = readCachedKey();
    if (cached) setApiKey(cached);
  }, []);

  useEffect(() => {
    if (!normalizedKey.startsWith('sk-')) {
      setQuota(null);
      return;
    }
    const timer = setTimeout(() => {
      refreshQuota(normalizedKey);
    }, 450);
    return () => clearTimeout(timer);
  }, [normalizedKey]);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  async function refreshQuota(key = normalizedKey) {
    if (!key.startsWith('sk-')) return;
    setQuotaLoading(true);
    try {
      const res = await fetch('/api/ppt/quota', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      });
      const body = await res.json();
      if (!body.success) {
        setQuota(null);
        setError(body.message || '额度查询失败');
        return;
      }
      setQuota(body.data);
      setError(null);
    } catch (e: any) {
      setQuota(null);
      setError(e?.message || '额度查询失败');
    } finally {
      setQuotaLoading(false);
    }
  }

  async function createPpt(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setTask(null);
    try {
      const res = await fetch('/api/ppt/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          apiKey: normalizedKey,
          title: title.trim(),
          scenario,
          style,
          slideCount,
          templateId,
          inputText: inputText.trim(),
        }),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.message || 'PPT 生成失败');
        return;
      }
      setTask({
        taskId: body.data.taskId,
        status: body.data.status,
        downloadUrl: body.data.downloadUrl,
        title: title.trim(),
      });
      if (body.data.quota) setQuota(body.data.quota);
    } catch (e: any) {
      setError(e?.message || 'PPT 生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function downloadPpt() {
    if (!task?.downloadUrl || !normalizedKey) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(task.downloadUrl, {
        headers: { Authorization: `Bearer ${normalizedKey}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `下载失败 ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${task.title || 'nassa-ppt'}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || '下载失败');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" />
            返回
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
            Nassa PPT
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
          <form onSubmit={createPpt} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500 text-slate-950">
                <Presentation className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">AI PPT 生成</h1>
                <div className="mt-1 text-sm text-slate-400">固定地址 · API Key 鉴权 · PPTX 下载</div>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <Globe className="h-4 w-4 text-cyan-300" />
                  请求地址
                </label>
                <div className="mt-2 flex gap-2">
                  <code className="flex-1 break-all rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-cyan-200">
                    {PPT_REQUEST_BASE_URL}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(PPT_REQUEST_BASE_URL, 'url')}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700"
                  >
                    {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied === 'url' ? '已复制' : '复制'}
                  </button>
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <KeyRound className="h-4 w-4 text-cyan-300" />
                  API Key
                </label>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-slate-300">标题</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={90}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="text-xs text-slate-400">场景</label>
                  <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  >
                    {PPT_SCENARIOS.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">风格</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  >
                    {PPT_STYLES.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">模板</label>
                  <select
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  >
                    {PPT_TEMPLATES.map((item) => (
                      <option key={item.id} value={item.id}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400">页数</label>
                  <input
                    type="number"
                    min={PPT_MIN_SLIDES}
                    max={PPT_MAX_SLIDES}
                    value={slideCount}
                    onChange={(e) => setSlideCount(Number(e.target.value) || PPT_DEFAULT_SLIDES)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300">
                  <FileText className="h-4 w-4 text-cyan-300" />
                  内容
                </label>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={9}
                  maxLength={16000}
                  className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm leading-6 text-slate-100 outline-none transition focus:border-cyan-400"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 font-medium text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? '生成中...' : '生成 PPT'}
              </button>
            </div>
          </form>

          <aside className="space-y-5">
            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-400">PPT 额度</div>
                  <div className="mt-1 text-2xl font-semibold text-slate-100">{quotaText}</div>
                </div>
                <button
                  type="button"
                  onClick={() => refreshQuota()}
                  disabled={!normalizedKey.startsWith('sk-') || quotaLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${quotaLoading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                <Presentation className="h-4 w-4 text-cyan-300" />
                任务
              </div>
              {task ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                    <div className="text-sm font-medium text-emerald-200">生成完成</div>
                    <div className="mt-1 break-all font-mono text-xs text-emerald-100/80">{task.taskId}</div>
                  </div>
                  <button
                    type="button"
                    onClick={downloadPpt}
                    disabled={!task.downloadUrl || downloading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 font-medium text-white transition hover:bg-emerald-600 disabled:bg-slate-700"
                  >
                    {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    下载 PPTX
                  </button>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-6 text-center text-sm text-slate-500">
                  还没有任务
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="text-sm font-medium text-slate-300">当前参数</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-400">场景</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-100">{scenario}</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-400">风格</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-100">{style}</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-400">模板</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-100">
                  {PPT_TEMPLATES.find((t) => t.id === templateId)?.label}
                </div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-400">页数</div>
                <div className="rounded-lg bg-slate-950 px-3 py-2 text-slate-100">{slideCount}</div>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
