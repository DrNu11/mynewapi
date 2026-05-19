"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/constants";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [capsLock, setCapsLock] = useState(false);

  const router = useRouter();
  const search = useSearchParams();
  const fromRaw = search?.get("from") || "/admin/redeem";
  const safeFrom =
    fromRaw.startsWith("/admin") && !fromRaw.startsWith("/admin/login")
      ? fromRaw
      : "/admin/redeem";

  useEffect(() => {
    if (!shake) return;
    const t = setTimeout(() => setShake(false), 500);
    return () => clearTimeout(t);
  }, [shake]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error || `登录失败 (${res.status})`);
        setShake(true);
        return;
      }
      router.replace(safeFrom);
      router.refresh();
    } catch (e: any) {
      setError(`网络错误: ${e?.message ?? e}`);
      setShake(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  }

  return (
    <LoginShell>
      <form
        onSubmit={handleSubmit}
        className={cn(
          "relative w-full max-w-md",
          "rounded-3xl border border-white/[0.08] bg-ink-950/60 p-8 sm:p-10",
          "shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.02)_inset]",
          "backdrop-blur-2xl",
          "transition-transform duration-150",
          shake && "animate-[shake_0.45s_cubic-bezier(.36,.07,.19,.97)_both]"
        )}
      >
        {/* 卡片内部边光 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{
            background:
              "linear-gradient(180deg, rgba(91,133,255,0.10) 0%, rgba(91,133,255,0) 35%)",
          }}
        />

        <header className="relative mb-8 text-center">
          <div className="mx-auto mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/30 to-brand-600/10 ring-1 ring-brand-400/30 text-brand-200 shadow-[0_8px_24px_-8px_rgba(91,133,255,0.5)]">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight gradient-text">
            {SITE.brand} 管理员
          </h1>
          <p className="mt-2 text-xs text-ink-400">
            登录一次 · <span className="text-brand-300">30 天</span> 内自动保持登录
          </p>
        </header>

        <div className="relative space-y-4">
          <Field
            label="用户名"
            icon={<User className="h-4 w-4" />}
          >
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyUp={handleKey}
              className={inputClass}
              placeholder="admin"
              autoFocus
              required
            />
          </Field>

          <Field
            label="密码"
            icon={<Lock className="h-4 w-4" />}
            hint={
              capsLock ? (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <AlertCircle className="h-3 w-3" /> Caps Lock 已开
                </span>
              ) : undefined
            }
          >
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={handleKey}
                className={cn(inputClass, "pr-11")}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-500 hover:text-ink-200 hover:bg-white/[0.05] transition-colors"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>
        </div>

        <div className="relative mt-5 min-h-[2.5rem]">
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2.5 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className={cn(
            "group relative mt-6 flex w-full items-center justify-center gap-2 overflow-hidden",
            "rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 px-5 py-3 text-sm font-semibold text-white",
            "shadow-[0_10px_30px_-10px_rgba(91,133,255,0.6)]",
            "transition-all hover:shadow-[0_14px_36px_-10px_rgba(91,133,255,0.8)] hover:brightness-110",
            "active:scale-[0.98]",
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
          )}
        >
          {/* 高光扫过 */}
          <span
            aria-hidden
            className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
          />
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              登录中...
            </>
          ) : (
            <>
              登录
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>

        <div className="relative mt-6 flex items-center gap-2 text-xs text-ink-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400/80" />
          <span>HMAC 签名 cookie · HttpOnly · 仅 HTTPS</span>
        </div>
      </form>
    </LoginShell>
  );
}

/* ---------- 装饰外壳 ---------- */
function LoginShell({ children }: { children?: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950 text-ink-100">
      {/* 极光渐变球 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 h-[42rem] w-[42rem] rounded-full opacity-40 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at center, rgba(91,133,255,0.45), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 h-[36rem] w-[36rem] rounded-full opacity-30 blur-3xl"
        style={{
          background:
            "radial-gradient(circle at center, rgba(168,85,247,0.4), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-1/4 h-72 w-72 rounded-full opacity-20 blur-3xl animate-[float_14s_ease-in-out_infinite]"
        style={{
          background:
            "radial-gradient(circle at center, rgba(34,211,238,0.45), transparent 70%)",
        }}
      />

      {/* 网格底纹 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%)",
        }}
      />

      {/* 顶部品牌条 */}
      <header className="relative z-10 px-6 sm:px-10 pt-6 sm:pt-8">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-200 hover:text-white transition-colors"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-bold shadow-[0_4px_12px_-2px_rgba(91,133,255,0.6)]">
            N
          </span>
          <span className="tracking-tight">{SITE.brand}</span>
        </a>
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-7rem)] items-center justify-center px-6 py-10">
        {children}
      </main>

      <footer className="relative z-10 pb-6 text-center text-xs text-ink-600">
        <span>{SITE.tagline}</span>
      </footer>

      {/* 局部 keyframes（不污染全局） */}
      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translate3d(0, 0, 0); }
          10%, 30%, 50%, 70%, 90% { transform: translate3d(-6px, 0, 0); }
          20%, 40%, 60%, 80% { transform: translate3d(6px, 0, 0); }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -30px) scale(1.05); }
        }
      `}</style>
    </div>
  );
}

/* ---------- Field ---------- */
const inputClass = cn(
  "w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3",
  "text-sm text-white placeholder:text-ink-600",
  "focus:outline-none focus:border-brand-400/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-400/20",
  "transition-all duration-150"
);

function Field({
  label,
  icon,
  hint,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-300">
          {icon ? <span className="text-ink-500">{icon}</span> : null}
          {label}
        </span>
        {hint ? <span className="text-[11px]">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}
