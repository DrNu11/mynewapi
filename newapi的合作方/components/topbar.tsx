"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Bell, User, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { quotaToUSD } from "@/lib/api";
import { formatUSD } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { LangSwitcher } from "@/components/lang-switcher";

export function Topbar() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { t } = useT();

  async function onLogout() {
    await logout();
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/80 backdrop-blur px-4 md:px-6">
      <div className="text-sm text-muted-foreground hidden sm:block">
        {t("nav.brandTagline")}
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <LangSwitcher />

        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : user ? (
          <>
            <Button asChild variant="ghost" size="sm" className="font-mono text-xs">
              <Link href="/dashboard" title={t("nav.balanceTooltip")}>
                {formatUSD(quotaToUSD(user.quota - user.used_quota))}
              </Link>
            </Button>
            <Button variant="ghost" size="icon" aria-label={t("nav.notifications")}>
              <Bell className="h-4 w-4" />
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard" title={user.display_name || user.username}>
                <User className="h-4 w-4 mr-2" />
                {user.display_name || user.username}
              </Link>
            </Button>
            <Button variant="ghost" size="icon" aria-label={t("auth.signout")} onClick={onLogout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">
                <User className="h-4 w-4 mr-2" />
                {t("auth.signin")}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">{t("auth.getStarted")}</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
