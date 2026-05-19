"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  Wallet,
  LayoutDashboard,
  Boxes,
  Tag,
  KeyRound,
  BookOpen,
  Sparkles,
} from "lucide-react";

// 合作方明确要求:Top-up(充值)放在左菜单顶部独立入口
// label 作为 i18n key,渲染时通过 useT 翻译
const PRIMARY = [
  { href: "/top-up", labelKey: "nav.topup", icon: Wallet, accent: true },
] as const;

const NAV = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/models", labelKey: "nav.models", icon: Boxes },
  { href: "/pricing", labelKey: "nav.pricing", icon: Tag },
  { href: "/api-keys", labelKey: "nav.apiKeys", icon: KeyRound },
  { href: "/docs", labelKey: "nav.docs", icon: BookOpen },
] as const;

export function Sidebar() {
  const path = usePathname();
  const { t } = useT();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card/40">
      <div className="px-5 py-5 border-b">
        <Link href="/" className="flex items-center gap-2 font-semibold text-lg">
          <Sparkles className="h-5 w-5 text-brand" />
          Toplenged AI
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {/* 顶部充值入口(合作方要求的位置) */}
        {PRIMARY.map(({ href, labelKey, icon: Icon, accent }) => {
          const active = path === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                accent && "bg-brand text-white hover:bg-brand-dark",
                !accent && active && "bg-accent text-accent-foreground",
                !accent && !active && "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </Link>
          );
        })}

        <div className="pt-3 pb-2 px-3 text-xs uppercase tracking-wider text-muted-foreground">
          {t("nav.workspace")}
        </div>

        {NAV.map(({ href, labelKey, icon: Icon }) => {
          const active = path === href || path?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t(labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-4 py-3 text-xs text-muted-foreground">
        {t("nav.backedBy")}{" "}
        <span className="font-medium text-foreground">api.toplenged.com</span>
      </div>
    </aside>
  );
}
