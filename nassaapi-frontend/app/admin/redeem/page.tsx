"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Copy,
  Check,
  Loader2,
  ExternalLink,
  RefreshCw,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CreatedItem {
  short_id: string;
  short_url: string;
  redemption_code: string;
  amount_usd: number;
  amount_quota: number;
}

interface ListItem extends CreatedItem {
  id: number;
  newapi_name: string;
  memo: string | null;
  customer_label: string | null;
  status: "active" | "revealed" | "expired" | "disabled";
  revealed_at: string | null;
  visit_count: number;
  created_at: string;
  expires_at: string | null;
}

export default function AdminRedeemPage() {
  // 表单状态
  const [amountUsd, setAmountUsd] = useState("");
  const [count, setCount] = useState("1");
  const [memo, setMemo] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [expiresInHours, setExpiresInHours] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedItem[]>([]);

  // 历史列表
  const [history, setHistory] = useState<ListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const router = useRouter();

  // 拉当前登录用户名
  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j?.ok && setMe(j.username))
      .catch(() => { });
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // 即便接口失败也跳登录页
    }
    router.replace("/admin/login");
    router.refresh();
  }

  async function loadHistory() {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/redeem/list?limit=30", {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.ok) setHistory(json.items);
    } finally {
      setLoadingList(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustCreated([]);

    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请填写有效的金额（USD）");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/redeem/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_usd: amount,
          count: Number(count) || 1,
          memo: memo.trim() || undefined,
          customer_label: customerLabel.trim() || undefined,
          expires_in_hours: Number(expiresInHours) || undefined,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "创建失败");
        return;
      }
      setJustCreated(json.items);
      // 清空 memo / customer_label，amount/count 保留方便连续生成同款
      setMemo("");
      setCustomerLabel("");
      loadHistory();
    } catch (e: any) {
      setError(`网络错误: ${e.message ?? e}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-950 py-12 px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              兑换码快速生成
            </h1>
            <p className="mt-2 text-ink-400 text-sm">
              填金额 → 一键生成 → 复制短链发给客户。客户点链接才看到码。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {me && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-ink-300"
                title="当前登录账号"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {me}
              </span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-ink-300 hover:bg-white/[0.06] hover:text-white transition-colors disabled:opacity-60"
              title="退出登录（清除 30 天 cookie）"
            >
              {loggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              退出
            </button>
          </div>
        </header>

        {/* ===== 创建表单 ===== */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="金额 (USD)" required>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                placeholder="例如 5.00"
                className={inputClass}
                required
              />
            </Field>
            <Field label="生成数量">
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="备注（自己看的）">
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="例如 老张 9 折"
                maxLength={200}
                className={inputClass}
              />
            </Field>
            <Field label="客户标识（可选）">
              <input
                type="text"
                value={customerLabel}
                onChange={(e) => setCustomerLabel(e.target.value)}
                placeholder="客户名/微信号/订单号"
                maxLength={100}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="过期时间（小时数，留空 = 永不过期）">
            <input
              type="number"
              min="0"
              value={expiresInHours}
              onChange={(e) => setExpiresInHours(e.target.value)}
              placeholder="例如 24（24 小时后过期）"
              className={inputClass}
            />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-ink-500">
              生成后会调 New API 创建对应金额的兑换码，并产出短链。
            </p>
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-ink-950",
                "hover:bg-ink-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              )}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  立即生成
                </>
              )}
            </button>
          </div>
        </form>

        {/* ===== 刚生成的结果 ===== */}
        {justCreated.length > 0 && (
          <section className="mt-8 rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.05] p-6">
            <h2 className="text-lg font-semibold text-emerald-300 mb-4">
              ✓ 已生成 {justCreated.length} 张码
            </h2>
            <div className="space-y-3">
              {justCreated.map((item) => (
                <ResultRow key={item.short_id} item={item} />
              ))}
            </div>
            <p className="mt-4 text-xs text-emerald-200/70">
              💡 复制 <strong>短链</strong>发给客户，客户点链接才能看到兑换码。
              短链比兑换码本身好发（短，可在群里点击）。
            </p>
          </section>
        )}

        {/* ===== 历史列表 ===== */}
        <section className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">历史</h2>
            <button
              type="button"
              onClick={loadHistory}
              disabled={loadingList}
              className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-white transition-colors"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loadingList && "animate-spin")}
              />
              刷新
            </button>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-xs text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                  <th className="px-4 py-2.5 text-left font-medium">金额</th>
                  <th className="px-4 py-2.5 text-left font-medium">客户</th>
                  <th className="px-4 py-2.5 text-left font-medium">状态</th>
                  <th className="px-4 py-2.5 text-left font-medium">短链</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {history.length === 0 && !loadingList && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-ink-500"
                    >
                      还没有记录。在上面创建第一张码吧 👆
                    </td>
                  </tr>
                )}
                {history.map((r) => (
                  <HistoryRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

const inputClass = cn(
  "w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5",
  "text-sm text-white placeholder:text-ink-500",
  "focus:outline-none focus:border-brand-400/60 focus:bg-white/[0.06] transition-colors"
);

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink-300 mb-1.5">
        {label}
        {required && <span className="ml-0.5 text-rose-400">*</span>}
      </span>
      {children}
    </label>
  );
}

function ResultRow({ item }: { item: CreatedItem }) {
  const [copiedField, setCopiedField] = useState<"url" | "code" | null>(null);

  function copy(text: string, field: "url" | "code") {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-ink-400">
          ${item.amount_usd.toFixed(2)} · {item.amount_quota.toLocaleString()} 額度
        </span>
        <a
          href={item.short_url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand-300 hover:text-brand-200 inline-flex items-center gap-1"
        >
          预览 <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={item.short_url}
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-mono text-white"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={() => copy(item.short_url, "url")}
          className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-400 transition-colors"
        >
          {copiedField === "url" ? (
            <>
              <Check className="h-3.5 w-3.5" /> 已复制
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> 复制短链
            </>
          )}
        </button>
      </div>
      <details className="mt-2">
        <summary className="text-xs text-ink-500 cursor-pointer hover:text-ink-300">
          查看裸兑换码（一般不需要）
        </summary>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={item.redemption_code}
            className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-mono text-ink-300"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => copy(item.redemption_code, "code")}
            className="text-xs text-ink-400 hover:text-white px-2 py-1.5"
          >
            {copiedField === "code" ? "已复制" : "复制码"}
          </button>
        </div>
      </details>
    </div>
  );
}

function HistoryRow({ row }: { row: ListItem }) {
  const [copied, setCopied] = useState(false);
  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const statusLabels: Record<string, { text: string; cls: string }> = {
    active: { text: "未领取", cls: "bg-amber-500/15 text-amber-300" },
    revealed: { text: "已查看", cls: "bg-emerald-500/15 text-emerald-300" },
    expired: { text: "已过期", cls: "bg-ink-500/15 text-ink-400" },
    disabled: { text: "已停用", cls: "bg-rose-500/15 text-rose-300" },
  };
  const s = statusLabels[row.status] ?? statusLabels.active;

  const created = new Date(row.created_at + "Z");
  const created_local = `${created.getMonth() + 1}/${created.getDate()} ${String(
    created.getHours()
  ).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`;

  return (
    <tr className="text-ink-200 hover:bg-white/[0.02]">
      <td className="px-4 py-2.5 text-xs text-ink-400 whitespace-nowrap">
        {created_local}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap">
        ${row.amount_usd?.toFixed(2) ?? "?"}
      </td>
      <td className="px-4 py-2.5 max-w-[180px] truncate text-ink-300">
        {row.customer_label || row.memo || (
          <span className="text-ink-600">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={cn("inline-block rounded px-2 py-0.5 text-xs", s.cls)}>
          {s.text}
        </span>
        {row.visit_count > 0 && (
          <span className="ml-2 text-xs text-ink-500">
            {row.visit_count} 次访问
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <button
          type="button"
          onClick={() => copy(row.short_url)}
          className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />/r/{row.short_id}
            </>
          )}
        </button>
      </td>
    </tr>
  );
}
