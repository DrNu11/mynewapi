"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUSD, formatNumber } from "@/lib/utils";
import { Wallet, KeyRound, Activity, Loader2 } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useAuth } from "@/lib/auth";
import { api, quotaToUSD, LogType, type LogEntry, type LogStat, type PageInfo } from "@/lib/api";
import { useT, type Locale } from "@/lib/i18n";

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

function relativeTime(unixSec: number, locale: Locale): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (locale === "zh") {
    if (diff < 60) return `${diff} 秒前`;
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days} 天前`;
    return new Date(unixSec * 1000).toLocaleDateString("zh-CN");
  }
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const { user } = useAuth();
  const { t, locale } = useT();
  const [stat7d, setStat7d] = useState<LogStat | null>(null);
  const [recent, setRecent] = useState<LogEntry[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - SEVEN_DAYS_SEC;

    // 并行拉两个接口 — 任一失败不影响另一个
    const statP = api
      .get<LogStat>("log/self/stat", {
        query: { type: LogType.Consume, start_timestamp: sevenDaysAgo, end_timestamp: now },
      })
      .catch(() => null);

    const listP = api
      .get<PageInfo<LogEntry>>("log/self", {
        query: { type: LogType.Consume, p: 1, page_size: 5 },
      })
      .catch(() => null);

    Promise.all([statP, listP]).then(([s, l]) => {
      if (cancelled) return;
      setStat7d(s);
      setRecent(l?.items ?? []);
      setLoadingLogs(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null; // 不会发生(RequireAuth 已保护),但 TS 需要

  const balance = quotaToUSD(user.quota - user.used_quota);
  const spent7d = stat7d ? quotaToUSD(stat7d.quota) : null;

  return (
    <div className="container py-10 lg:py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("dashboard.welcome", { name: user.display_name || user.username })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <span className="text-sm font-medium text-muted-foreground">{t("dashboard.balance")}</span>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{formatUSD(balance)}</div>
            <Button asChild size="sm" className="mt-3 w-full">
              <Link href="/top-up">{t("dashboard.balanceTopUp")}</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <span className="text-sm font-medium text-muted-foreground">{t("dashboard.7dSpend")}</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">
              {spent7d === null ? <span className="text-muted-foreground text-base">{t("common.dash")}</span> : formatUSD(spent7d)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("dashboard.totalSpent", { amount: formatUSD(quotaToUSD(user.used_quota)) })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <span className="text-sm font-medium text-muted-foreground">{t("dashboard.requests")}</span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tabular-nums">{formatNumber(user.request_count)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("dashboard.requestsSub", { rpm: stat7d?.rpm ?? 0 })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <span className="text-sm font-medium text-muted-foreground">{t("dashboard.role")}</span>
            <KeyRound className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {user.role >= 100 ? t("dashboard.roleRoot") : user.role >= 10 ? t("dashboard.roleAdmin") : t("dashboard.roleUser")}
            </div>
            <Badge variant="info" className="mt-1.5">{t("dashboard.groupLabel", { group: user.group })}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Aff code — NewAPI 自带的邀请功能 */}
      {user.aff_code && (
        <Card>
          <CardHeader className="pb-3">
            <h2 className="font-semibold">{t("dashboard.inviteTitle")}</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("dashboard.inviteText")}
            </p>
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <span className="font-mono text-sm flex-1">{user.aff_code}</span>
              <Badge variant="outline">{t("dashboard.inviteCodeBadge")}</Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent activity — 接 GET /api/log/self?type=2&p=1&page_size=5 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <h2 className="font-semibold">{t("dashboard.recentActivity")}</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/api-keys">{t("dashboard.viewAll")}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {loadingLogs ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">{t("common.loading")}</span>
            </div>
          ) : recent && recent.length > 0 ? (
            <div className="rounded-lg border divide-y">
              {recent.map((row) => {
                const totalTok = (row.prompt_tokens || 0) + (row.completion_tokens || 0);
                const cost = quotaToUSD(row.quota);
                return (
                  <div key={row.id} className="flex items-center justify-between p-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="text-muted-foreground tabular-nums w-20 shrink-0">
                        {relativeTime(row.created_at, locale)}
                      </div>
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded truncate">
                        {row.model_name || t("common.dash")}
                      </span>
                      {row.token_name && (
                        <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                          {row.token_name}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-6 text-sm tabular-nums shrink-0">
                      <span className="text-muted-foreground">{formatNumber(totalTok)} tok</span>
                      <span className="font-medium w-16 text-right">
                        {cost === 0 ? <Badge variant="success">Free</Badge> : formatUSD(cost)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("dashboard.noActivity")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("dashboard.noActivityHint")}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/api-keys">{t("dashboard.createKey")}</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
