"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Download,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

type Provider = {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  models?: { id: string; name: string; reasoning?: boolean }[];
};

export default function ProviderDetailPage({ params }: { params: { name: string } }) {
  const router = useRouter();
  const name = decodeURIComponent(params.name);
  const [p, setP] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  // dialogs state
  const [editKey, setEditKey] = useState(false);
  const [editBase, setEditBase] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [dangerDeleteOpen, setDangerDeleteOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(name)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setP(j.provider);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [name]);

  async function doDeleteModel(modelId: string) {
    if (!confirm(`确认删除模型 "${modelId}"?\n(配置 + 自动备份)`)) return;
    try {
      const r = await fetch(
        `/api/providers/${encodeURIComponent(name)}/models/${encodeURIComponent(modelId)}`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "delete failed");
      await load();
    } catch (e: any) {
      alert("失败: " + (e?.message || String(e)));
    }
  }

  const models = p?.models || [];
  const filtered = filter
    ? models.filter((m) => m.id.toLowerCase().includes(filter.toLowerCase()) || (m.name || "").toLowerCase().includes(filter.toLowerCase()))
    : models;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="size-3.5" />
          返回 Provider 列表
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ⚠ {error}
        </div>
      )}

      {loading && !p ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-slate-400">加载中…</div>
      ) : p ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{name}</h1>
                <p className="mt-1 text-xs text-slate-500">api: {p.api || "—"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setRenameOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                >
                  <Pencil className="size-3.5" />
                  重命名
                </button>
                <button
                  onClick={() => setDangerDeleteOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="size-3.5" />
                  删除 Provider
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="baseUrl" value={p.baseUrl || ""} onEdit={() => setEditBase(true)} />
              <Field label="apiKey" value={p.apiKey || ""} onEdit={() => setEditKey(true)} mono />
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <div>
                <h2 className="text-lg font-semibold">模型列表</h2>
                <p className="text-xs text-slate-500">共 {models.length} 个</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="搜索 id / name…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-56 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm placeholder:text-slate-400"
                />
                <button
                  onClick={() => setDiscoverOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                  title="调上游 /v1/models 拉清单后批量选择"
                >
                  <Download className="size-3.5" />
                  获取模型列表
                </button>
                <button
                  onClick={() => setAddOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Plus className="size-3.5" />
                  手动添加
                </button>
              </div>
            </header>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2 font-medium">id</th>
                  <th className="px-4 py-2 font-medium">name</th>
                  <th className="w-24 px-4 py-2 font-medium">reasoning</th>
                  <th className="w-16 px-4 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs">{m.id}</td>
                    <td className="px-4 py-2">{m.name}</td>
                    <td className="px-4 py-2">
                      {m.reasoning ? (
                        <span className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">
                          <Brain className="size-3" /> yes
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => doDeleteModel(m.id)}
                        className="text-slate-400 hover:text-red-600"
                        title="删除模型"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                      {models.length === 0 ? "暂无模型,点击右上「添加模型」" : "无匹配结果"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {editKey && (
            <EditDialog
              title="改 apiKey"
              label="新 apiKey"
              placeholder="sk-xxx…"
              initial=""
              onClose={() => setEditKey(false)}
              onSubmit={async (v) => {
                const r = await fetch(`/api/providers/${encodeURIComponent(name)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ apiKey: v }),
                });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || "保存失败");
                await load();
              }}
            />
          )}

          {editBase && (
            <EditDialog
              title="改 baseUrl"
              label="新 baseUrl"
              placeholder="http://127.0.0.1:8317/v1"
              initial={p.baseUrl || ""}
              onClose={() => setEditBase(false)}
              onSubmit={async (v) => {
                const r = await fetch(`/api/providers/${encodeURIComponent(name)}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ baseUrl: v }),
                });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || "保存失败");
                await load();
              }}
            />
          )}

          {renameOpen && (
            <EditDialog
              title="重命名 Provider"
              label="新 Provider 名"
              placeholder="如 nassa-aggregator"
              initial={name}
              hint="只能含字母、数字、下划线、连字符、点"
              onClose={() => setRenameOpen(false)}
              onSubmit={async (v) => {
                const r = await fetch(`/api/providers/${encodeURIComponent(name)}/rename`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ newName: v }),
                });
                const j = await r.json();
                if (!r.ok) throw new Error(j.error || "保存失败");
                router.push(`/provider/${encodeURIComponent(v)}`);
              }}
            />
          )}

          {addOpen && (
            <AddModelDialog
              providerName={name}
              onClose={() => setAddOpen(false)}
              onAdded={async () => {
                setAddOpen(false);
                await load();
              }}
            />
          )}

          {discoverOpen && (
            <DiscoverModelsDialog
              providerName={name}
              baseUrl={p.baseUrl || ""}
              onClose={() => setDiscoverOpen(false)}
              onAdded={async () => {
                setDiscoverOpen(false);
                await load();
              }}
            />
          )}

          {dangerDeleteOpen && (
            <DangerDeleteDialog
              providerName={name}
              modelCount={models.length}
              onClose={() => setDangerDeleteOpen(false)}
              onDeleted={() => router.push("/")}
            />
          )}
        </>
      ) : null}
    </main>
  );
}

function Field({
  label,
  value,
  onEdit,
  mono,
}: {
  label: string;
  value: string;
  onEdit: () => void;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <Pencil className="size-3" />
          编辑
        </button>
      </div>
      <div className={`break-all text-sm text-slate-800 ${mono ? "font-mono" : ""}`}>
        {value || <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}

function EditDialog({
  title,
  label,
  placeholder,
  initial,
  hint,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder: string;
  initial: string;
  hint?: string;
  onClose: () => void;
  onSubmit: (v: string) => Promise<void>;
}) {
  const [val, setVal] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!val.trim()) {
      setErr("值不能为空");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSubmit(val.trim());
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <label className="mb-1 block text-xs font-medium uppercase text-slate-500">{label}</label>
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-slate-400 focus:outline-none"
        disabled={busy}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {err && <p className="mt-2 text-xs text-red-600">⚠ {err}</p>}
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
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
    </Modal>
  );
}

function AddModelDialog({
  providerName,
  onClose,
  onAdded,
}: {
  providerName: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!id.trim()) {
      setErr("model id 必填");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(providerName)}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.trim(), name: name.trim() || id.trim(), reasoning }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "添加失败");
      onAdded();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="添加模型" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-slate-500">id *</label>
          <input
            autoFocus
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="如 deepseek-v5-pro"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-slate-500">name(显示名)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="留空则用 id"
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
          标记为 reasoning(推理)模型
        </label>
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
          {busy ? "保存中…" : "添加"}
        </button>
      </div>
    </Modal>
  );
}

function DangerDeleteDialog({
  providerName,
  modelCount,
  onClose,
  onDeleted,
}: {
  providerName: string;
  modelCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const matched = confirmText === providerName;

  async function submit() {
    if (!matched) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(providerName)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: providerName }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "删除失败");
      onDeleted();
    } catch (e: any) {
      setErr(e?.message || String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-red-700">
          <AlertTriangle className="size-5" />
          危险:删除整个 Provider
        </h3>
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            即将从 <span className="font-mono">openclaw.json</span> 移除 provider{" "}
            <span className="font-mono font-bold text-red-700">{providerName}</span> 和其下{" "}
            <span className="font-bold">{modelCount} 个模型</span>。
          </p>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ OpenClaw 会自动 hot reload 应用变更。若 NewAPI / 其他系统正引用此 provider 的模型,将立即失效。
            备份会自动保留在 <span className="font-mono">openclaw.json.bak.&lt;ts&gt;</span>。
          </p>
        </div>

        <div className="mt-4 mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-slate-600">
            请精确输入 provider 名字以确认:
          </label>
          <button
            type="button"
            onClick={() => setConfirmText(providerName)}
            className="text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
            disabled={busy}
          >
            一键填入
          </button>
        </div>
        <div className="mb-2 rounded-md bg-slate-100 px-3 py-1.5 font-mono text-xs text-slate-700">
          {providerName}
        </div>
        <input
          autoFocus
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="把上面那串粘贴/输入到这里"
          disabled={busy}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-sm focus:border-red-400 focus:outline-none"
          onKeyDown={(e) => e.key === "Enter" && matched && submit()}
        />
        {confirmText && !matched && (
          <p className="mt-1 text-xs text-amber-600">还差几个字符…按「一键填入」可自动填</p>
        )}

        {err && <p className="mt-2 text-xs text-red-600">⚠ {err}</p>}

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
            disabled={!matched || busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "删除中…" : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscoverModelsDialog({
  providerName,
  baseUrl,
  onClose,
  onAdded,
}: {
  providerName: string;
  baseUrl: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [models, setModels] = useState<{ id: string; alreadyAdded: boolean }[] | null>(null);
  const [triedUrl, setTriedUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ added: number; skipped: number } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const r = await fetch(`/api/providers/${encodeURIComponent(providerName)}/discover`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "拉取失败");
        setModels(j.models);
        setTriedUrl(j.triedUrl);
        // 默认勾上所有「未添加过」的
        const defaultSel = new Set<string>(
          (j.models as any[]).filter((m) => !m.alreadyAdded).map((m) => m.id)
        );
        setSelected(defaultSel);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [providerName]);

  const filtered = (models || []).filter((m) =>
    filter ? m.id.toLowerCase().includes(filter.toLowerCase()) : true
  );

  function toggle(id: string) {
    const ns = new Set(selected);
    if (ns.has(id)) ns.delete(id);
    else ns.add(id);
    setSelected(ns);
  }

  function selectAll() {
    setSelected(new Set(filtered.filter((m) => !m.alreadyAdded).map((m) => m.id)));
  }
  function selectNone() {
    setSelected(new Set());
  }

  async function save() {
    const ids = Array.from(selected).filter((id) => {
      const m = models?.find((x) => x.id === id);
      return m && !m.alreadyAdded;
    });
    if (ids.length === 0) {
      setError("没有要添加的模型(已添加的会跳过)");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`/api/providers/${encodeURIComponent(providerName)}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, reasoning }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "添加失败");
      setSaveResult({ added: (j.added || []).length, skipped: (j.skipped || []).length });
      setTimeout(() => onAdded(), 800);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const newSelectableCount = (models || []).filter((m) => !m.alreadyAdded).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-slate-200 p-5">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Download className="size-4" />
            从上游获取模型列表
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            调 <span className="font-mono">{baseUrl}</span> 的 <span className="font-mono">/v1/models</span>(或 /models)
          </p>
        </header>

        {loading && (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="size-5 animate-spin" />
            正在拉取上游模型列表…(最多 10 秒)
          </div>
        )}

        {error && (
          <div className="mx-5 my-4 whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <div className="mb-1 font-semibold">⚠ 拉取失败</div>
            {error}
            <p className="mt-2 text-slate-600">
              可能原因:① 上游不支持 /v1/models 标准接口(如 cli-proxy-api 自定义协议)、② apiKey 错误、③ baseUrl 拼错。
              请改用<b>「手动添加」</b>按钮一个一个加。
            </p>
          </div>
        )}

        {!loading && models && !error && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <div className="text-xs text-slate-600">
                上游共 <b>{models.length}</b> 个 · 未添加 <b className="text-emerald-700">{newSelectableCount}</b> 个 ·
                已选 <b>{selected.size}</b>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={selectAll} className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
                  全选未添加
                </button>
                <span className="text-slate-300">·</span>
                <button onClick={selectNone} className="text-xs text-slate-500 hover:text-slate-900 hover:underline">
                  清空
                </button>
              </div>
            </div>

            <div className="border-b border-slate-200 px-5 py-2">
              <div className="relative">
                <Search className="absolute left-2 top-2 size-3.5 text-slate-400" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="搜索模型 id…"
                  className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">无匹配结果</p>
              ) : (
                <ul className="space-y-1">
                  {filtered.map((m) => (
                    <li key={m.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 ${m.alreadyAdded ? "opacity-60" : ""
                          }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(m.id) || m.alreadyAdded}
                          disabled={m.alreadyAdded}
                          onChange={() => toggle(m.id)}
                        />
                        <span className="flex-1 font-mono">{m.id}</span>
                        {m.alreadyAdded && (
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">已添加</span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="border-t border-slate-200 p-4">
              <label className="mb-3 flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={reasoning}
                  onChange={(e) => setReasoning(e.target.checked)}
                />
                把选中的全部标记为 <b>reasoning</b>(推理模型,UI 会显示思考过程)
              </label>
              {saveResult && (
                <p className="mb-2 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                  ✅ 已添加 {saveResult.added} 个 · 跳过 {saveResult.skipped} 个
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={saving || selected.size === 0}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {saving ? "保存中…" : `添加 ${selected.size} 个`}
                </button>
              </div>
              {triedUrl && (
                <p className="mt-2 text-right font-mono text-[10px] text-slate-400">
                  source: {triedUrl}
                </p>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}
