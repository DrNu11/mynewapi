"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { AlertCircle, Loader2 } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="container py-16 max-w-md"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const { login } = useAuth();
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      router.push(next);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg || t("auth.signinFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container py-16 max-w-md">
      <Card>
        <CardHeader className="space-y-1.5 pb-4 text-center">
          <h1 className="text-2xl font-semibold">{t("auth.welcomeBack")}</h1>
          <p className="text-sm text-muted-foreground">{t("auth.welcomeBackSub")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="username">
                {t("auth.usernameOrEmail")}
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("auth.usernamePlaceholder")}
                className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium" htmlFor="password">
                  {t("auth.password")}
                </label>
                <Link href="#" className="text-xs text-brand hover:underline">
                  {t("auth.forgot")}
                </Link>
              </div>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
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
              {submitting ? t("auth.signingIn") : t("auth.signin")}
            </Button>
          </form>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-card px-2 text-muted-foreground">{t("auth.or")}</span>
            </div>
          </div>

          <div className="grid gap-2">
            <Button variant="outline" className="w-full" disabled>
              {t("auth.continueGoogle")}
            </Button>
            <Button variant="outline" className="w-full" disabled>
              {t("auth.continueGithub")}
            </Button>
          </div>

          <p className="text-center text-sm text-muted-foreground pt-2">
            {t("auth.noAccount")}{" "}
            <Link href="/signup" className="text-brand hover:underline">
              {t("auth.signupHere")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
