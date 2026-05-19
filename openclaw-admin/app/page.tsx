"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Box,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Target,
} from "lucide-react";

type ProviderSummary = {
  name: string;
  baseUrl: string;
  apiKeyTail: string;
  api: string;
  modelCount: number;
};

type HealthState = { ok: boolean; gateway?: any; error?: string; gatewayUrl?: string };
type DefaultModel = { primary: string; fallbacks: string[] };

export default function HomePage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [configPath, setConfigPath] = useState<string>("");
  const [health, setHealth] = useState<HealthState | null>(null);
  const [defaultModel, setDefaultModel] = useState<DefaultModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [pRes, hRes, dRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/health", { cache: "no-store" }),
        fetch("/api/defaults", { cache: "no-store" }),
      ]);
      const p = await pRes.json();
      const h = await hRes.json();
      const d = await dRes.json();
      if (!pRes.ok) throw new Error(p.error || "load providers failed");
      setProviders(p.providers || []);
      setConfigPath(p.configPath || "");
      setHealth(h);
      if (dRes.ok) setDefaultModel({ primary: d.primary || "", fallbacks: d.fallbacks || [] });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Box className="size-8 text-slate-700" />
            OpenClaw Admin
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Provider 与模型可视化管理 ·{" "}
            <span className="font-mono text-xs">{configPath || "loading…"}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <HealthBadge state={health} />
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            <Plus className="size-3.5" />
            添加 Provider
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            <RefreshCw className="size-3.5" />
            刷新
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠ {error}
        </div>
      )}

      {defaultModel !== null && (
        <CurrentDefaultCard
          defaultModel={defaultModel}
          onClickChange={() => setPickerOpen(true)}
        />
      )}

      {loading && providers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center text-sm text-slate-400">
          加载中…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {providers.map((p) => (
            <Link
              key={p.name}
              href={`/provider/${encodeURIComponent(p.name)}`}
              className="group block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-slate-900 group-hover:text-slate-700">
                    {p.name}
                  </h2>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{p.baseUrl}</p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  {p.api}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Layers className="size-3.5 text-slate-400" />
                  <span>{p.modelCount} 个模型</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <KeyRound className="size-3.5 text-slate-400" />
                  <span className="font-mono text-xs">{p.apiKeyTail || "—"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400">
        OpenClaw Admin · 写入会原子备份 · OpenClaw gateway 支持 hot reload
      </footer>

      {createOpen && (
        <CreateProviderDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(name) => {
            setCreateOpen(false);
            router.push(`/provider/${encodeURIComponent(name)}`);
          }}
        />
      )}

      {pickerOpen && (
        <ModelPickerDialog
          current={defaultModel?.primary || ""}
          onClose={() => setPickerOpen(false)}
          onPicked={async () => {
            setPickerOpen(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

function CurrentDefaultCard({
  defaultModel,
  onClickChange,
}: {
  defaultModel: DefaultModel;
  onClickChange: () => void;
}) {
  const [primaryProv, primaryModel] = (defaultModel.primary || "").split("/", 2);
  return (
    <section className="mb-6 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-emerald-700">
            <Target className="size-3.5" />
            当前默认模型
          </div>
          {defaultModel.primary ? (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{primaryModel}</span>
              <span className="text-sm text-slate-500">来自</span>
              <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-medium text-white">
                {primaryProv}
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">还没设置 — 点右边按钮选一个</p>
          )}
          {defaultModel.fallbacks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span>Fallback:</span>
              {defaultModel.fallbacks.map((f, i) => (
                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onClickChange}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
        >
          <Pencil className="size-3.5" />
          切换模型
        </button>
      </div>
    </section>
  );
}

function ModelPickerDialog({
  current,
  onClose,
  onPicked,
}: {
  current: string;
  onClose: () => void;
  onPicked: () => void;
}) {
  // Step 1: pick provider; Step 2: pick model
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[] | null>(null);
  const [pickedProvider, setPickedProvider] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/providers", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "load failed");
        setProviders(j.providers || []);
        // 预选当前 primary 的 provider
        const [currentProv] = (current || "").split("/", 2);
        if (currentProv) await loadProviderModels(currentProv);
      } catch (e: any) {
        setErr(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProviderModels(provName: string) {
    setPickedProvider(provName);
    setModels(null);
    setFilter("");
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(provName)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load models failed");
      setModels(j.provider?.models || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function pickModel(modelId: string) {
    if (!pickedProvider || !modelId) return;
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary: `${pickedProvider}/${modelId}` }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "保存失败");
      onPicked();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setSaving(false);
    }
  }

  const filteredModels = (models || []).filter((m) =>
    filter ? m.id.toLowerCase().includes(filter.toLowerCase()) : true
  );
  const [currentProv, currentModel] = (current || "").split("/", 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="size-4" />
            选择当前默认模型
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            两步:① 选供应商 → ② 选它提供的模型
          </p>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">加载中…</div>
        ) : (
          <div className="grid flex-1 grid-cols-2 overflow-hidden">
            {/* Step 1: providers */}
            <div className="overflow-y-auto border-r border-slate-200">
              <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                ① 供应商({providers.length})
              </div>
              <ul>
                {providers.map((p) => {
                  const isCurrent = p.name === currentProv;
                  const isPicked = p.name === pickedProvider;
                  return (
                    <li key={p.name}>
                      <button
                        onClick={() => loadProviderModels(p.name)}
                        className={`flex w-full items-center justify-between gap-2 border-l-2 px-4 py-2.5 text-left text-sm hover:bg-slate-50 ${isPicked
                            ? "border-emerald-500 bg-emerald-50"
                            : "border-transparent"
                          }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 truncate font-medium">
                            {p.name}
                            {isCurrent && <CheckCircle2 className="size-3.5 text-emerald-600" />}
                          </div>
                          <div className="text-xs text-slate-500">{p.modelCount} 个模型</div>
                        </div>
                        <ChevronRight className="size-3.5 shrink-0 text-slate-400" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Step 2: models */}
            <div className="flex flex-col overflow-hidden">
              <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                ② 模型 {pickedProvider && `· ${pickedProvider}`}
              </div>
              {!pickedProvider ? (
                <p className="flex-1 p-6 text-center text-sm text-slate-400">← 左边先选个供应商</p>
              ) : !models ? (
                <p className="flex-1 p-6 text-center text-sm text-slate-400">加载中…</p>
              ) : models.length === 0 ? (
                <p className="flex-1 p-6 text-center text-sm text-slate-400">
                  这个供应商还没有模型,先去详情页加
                </p>
              ) : (
                <>
                  <div className="border-b border-slate-200 p-2">
                    <input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="搜索模型 id…"
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:border-slate-400 focus:outline-none"
                    />
                  </div>
                  <ul className="flex-1 overflow-y-auto">
                    {filteredModels.map((m) => {
                      const isCurrent = pickedProvider === currentProv && m.id === currentModel;
                      return (
                        <li key={m.id}>
                          <button
                            disabled={saving}
                            onClick={() => pickModel(m.id)}
                            className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-emerald-50 ${isCurrent ? "bg-emerald-50 font-medium" : ""
                              } disabled:opacity-50`}
                          >
                            <span className="truncate font-mono text-xs">{m.id}</span>
                            {isCurrent && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                                当前
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {err && <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">⚠ {err}</div>}

        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">
            点击右侧模型即直接保存,不需要其他确认
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

const API_TYPES = [
  { value: "openai-completions", label: "OpenAI Completions(默认,大多兼容)" },
  { value: "anthropic-messages", label: "Anthropic Messages(claude)" },
  { value: "openai-responses", label: "OpenAI Responses(codex /v1/responses)" },
  { value: "gemini-generate", label: "Gemini Generate" },
];

function CreateProviderDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState("openai-completions");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) {
      setErr("name / baseUrl / apiKey 都必填");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          api,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "创建失败");
      onCreated(name.trim());
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold">添加 Provider</h3>
        <p className="mb-4 text-xs text-slate-500">
          创建后跳进详情页,在详情页里添加该 provider 支持的模型。
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-500">name * (唯一标识)</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 anthropic-real / nassa-deepseek / openrouter"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-slate-400 focus:outline-none"
              disabled={busy}
            />
            <p className="mt-1 text-xs text-slate-400">字母/数字/下划线/连字符/点,要全局唯一</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-500">baseUrl *</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1 或 http://127.0.0.1:8317/v1"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-slate-400 focus:outline-none"
              disabled={busy}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-500">apiKey *</label>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-xxx…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-slate-400 focus:outline-none"
              disabled={busy}
              type="text"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-500">api 类型</label>
            <select
              value={api}
              onChange={(e) => setApi(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              disabled={busy}
            >
              {API_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">大多数上游兼容 OpenAI Completions,选默认即可</p>
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-red-600">⚠ {err}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthBadge({ state }: { state: HealthState | null }) {
  if (!state) return null;
  const ok = state.ok && state.gateway?.ok;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
        }`}
      title={state.gatewayUrl}
    >
      <Activity className="size-3" />
      Gateway {ok ? "online" : "offline"}
    </span>
  );
}
