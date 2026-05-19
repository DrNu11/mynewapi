"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Plus, Eye, Trash2, Loader2, Copy, Check, AlertCircle } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { api, type Token, type PageInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";

export default function ApiKeysPage() {
  return (
    <RequireAuth>
      <ApiKeysContent />
    </RequireAuth>
  );
}

function ApiKeysContent() {
  const { t, locale } = useT();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<PageInfo<Token>>("token/", { query: { p: 1, size: 50 } });
      setTokens(page?.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  async function onCreate() {
    const name = window.prompt(t("apiKeys.namePrompt"), t("apiKeys.defaultName"));
    if (!name) return;
    if (name.length > 50) {
      window.alert(t("apiKeys.nameTooLong"));
      return;
    }
    setCreating(true);
    try {
      await api.post("token/", {
        name,
        unlimited_quota: true,
        expired_time: -1,
        remain_quota: 0,
        model_limits_enabled: false,
        model_limits: "",
        allow_ips: "",
        group: "",
      });
      await loadTokens();
    } catch (err) {
      window.alert(t("apiKeys.failCreate", { error: (err as Error).message }));
    } finally {
      setCreating(false);
    }
  }

  async function onReveal(id: number) {
    try {
      // 注意:NewAPI 的 GetTokenKey 是 POST 不是 GET(critical rate limit + disable cache 保护)
      const data = await api.post<{ key: string }>(`token/${id}/key`);
      if (data?.key) {
        setRevealed((prev) => ({ ...prev, [id]: data.key }));
      }
    } catch (err) {
      window.alert(t("apiKeys.failReveal", { error: (err as Error).message }));
    }
  }

  async function onCopy(id: number, key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.alert(t("apiKeys.copyFailed"));
    }
  }

  async function onDelete(id: number, name: string) {
    if (!window.confirm(t("apiKeys.deletePrompt", { name }))) {
      return;
    }
    try {
      await api.delete(`token/${id}`);
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadTokens();
    } catch (err) {
      window.alert(t("apiKeys.failDelete", { error: (err as Error).message }));
    }
  }

  return (
    <div className="container py-10 lg:py-12 space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("apiKeys.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("apiKeys.subtitleAlt")}
          </p>
        </div>
        <Button onClick={onCreate} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
          {creating ? t("apiKeys.creating") : t("apiKeys.createBtn")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            {t("apiKeys.activeKeys", { count: tokens.length })}
          </h2>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <KeyRound className="h-8 w-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">{t("apiKeys.emptyHint")}</p>
            </div>
          ) : (
            <div className="rounded-lg border divide-y">
              {tokens.map((tok) => {
                const fullKey = revealed[tok.id];
                const displayKey = fullKey ? `sk-${fullKey}` : `sk-${tok.key}`;
                return (
                  <div key={tok.id} className="flex items-center justify-between p-4 text-sm gap-4 flex-wrap">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="font-medium">{tok.name}</div>
                      <div className="font-mono text-xs text-muted-foreground break-all">{displayKey}</div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                      <div className="text-right">
                        <div className="text-muted-foreground/60">{t("apiKeys.created")}</div>
                        <div className="tabular-nums">
                          {new Date(tok.created_time * 1000).toLocaleDateString(locale === "zh" ? "zh-CN" : undefined)}
                        </div>
                      </div>
                      <Badge variant={tok.status === 1 ? "success" : "secondary"}>
                        {tok.status === 1
                          ? t("apiKeys.statusActive")
                          : tok.status === 3
                            ? t("apiKeys.statusExpired")
                            : t("apiKeys.statusDisabled")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {fullKey ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("apiKeys.actionCopy")}
                          onClick={() => onCopy(tok.id, displayKey)}
                        >
                          {copiedId === tok.id ? (
                            <Check className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon" aria-label={t("apiKeys.actionReveal")} onClick={() => onReveal(tok.id)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("apiKeys.actionDelete")}
                        onClick={() => onDelete(tok.id, tok.name)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-amber-50 text-amber-900 p-4 text-sm">
        <strong>{t("apiKeys.securityHeadsup")}</strong> {t("apiKeys.securityText")}
      </div>
    </div>
  );
}
