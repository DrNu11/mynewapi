"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function SignupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // 客户端基本校验
    if (username.length < 3) {
      setError(t("auth.usernameMin3"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordMin8"));
      return;
    }

    setSubmitting(true);
    try {
      await register(username, password); // register() 内部会自动 login + 拉 self
      router.push("/dashboard");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg || t("auth.signupFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container py-16 grid lg:grid-cols-2 gap-10 max-w-5xl items-start">
      {/* Left: form */}
      <Card>
        <CardHeader className="space-y-1.5 pb-4">
          <h1 className="text-2xl font-semibold">{t("auth.signupTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.signupSubShort")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="su-username">
                {t("auth.username")}
              </label>
              <input
                id="su-username"
                type="text"
                autoComplete="username"
                required
                minLength={3}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.usernameMin3Placeholder")}
                className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="su-password">
                {t("auth.password")}
              </label>
              <input
                id="su-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordMin8Placeholder")}
                className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting ? t("auth.creatingAccount") : t("auth.signupCta")}
            </Button>
          </form>

          <div className="grid gap-2 pt-2">
            <Button variant="outline" className="w-full" disabled>
              {t("auth.signupGoogle")}
            </Button>
            <Button variant="outline" className="w-full" disabled>
              {t("auth.signupGithub")}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground">
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="text-brand hover:underline">
              {t("auth.signinHere")}
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* Right: benefits */}
      <div className="space-y-5 lg:pt-8">
        <h2 className="text-xl font-semibold">{t("signup.whatYouGet")}</h2>
        <ul className="space-y-3">
          {[
            "signup.benefit.openSource",
            "signup.benefit.openaiCompatible",
            "signup.benefit.payAsYouGo",
            "signup.benefit.uptime",
            "signup.benefit.oneKey",
          ].map((key) => (
            <li key={key} className="flex items-start gap-3">
              <Check className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-sm">{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
