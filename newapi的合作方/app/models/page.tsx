"use client";

import { useEffect, useState } from "react";
import { ModelCard } from "@/components/model-card";
import { MODELS, type ModelInfo } from "@/lib/models";
import { api, UnauthorizedError } from "@/lib/api";
import { Loader2, Sparkles } from "lucide-react";

type ModelView = {
  paid: ModelInfo[];
  free: ModelInfo[];
  status: "loading" | "live" | "preview"; // live = 上游有真模型 / preview = 上游空,只展示 mock 目录
  liveCount: number;
};

export default function ModelsPage() {
  const [view, setView] = useState<ModelView>({
    paid: [],
    free: [],
    status: "loading",
    liveCount: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // NewAPI 的 /api/user/models 返回纯模型 ID 数组(string[])。
      // 路由实际定义在 api-router.go selfRoute(prefix /api/user/),GET("/models") = /api/user/models。
      // 依赖 user 登录态(cookie + New-Api-User),未登录会返回 401 — 静默 fallback 到 preview 模式。
      let liveNames: string[] = [];
      try {
        const arr = await api.get<string[]>("user/models");
        liveNames = Array.isArray(arr) ? arr : [];
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) {
          console.warn("Failed to load live models:", err);
        }
      }

      if (cancelled) return;

      if (liveNames.length === 0) {
        // 上游没模型(海外站还没导 channel)或者未登录 — 展示 preview 目录
        setView({
          paid: MODELS.filter((m) => m.tier === "paid"),
          free: MODELS.filter((m) => m.tier === "free"),
          status: "preview",
          liveCount: 0,
        });
        return;
      }

      // 有真实模型:左 join — mock 里有元数据的用 mock 显示,没的简化展示
      const live: ModelInfo[] = liveNames.map((id) => {
        const meta = MODELS.find((m) => m.id === id);
        if (meta) return meta;
        // fallback:上游有但 mock 没,造一个 placeholder
        return {
          id,
          name: id,
          provider: "Custom",
          tier: "free" as const,
          contextK: 0,
          capability: ["chat"],
          description: "Live model from upstream",
        };
      });

      setView({
        paid: live.filter((m) => m.tier === "paid"),
        free: live.filter((m) => m.tier === "free"),
        status: "live",
        liveCount: live.length,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container py-10 lg:py-12 space-y-12">
      <div className="space-y-2 max-w-3xl">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Models</h1>
        <p className="text-muted-foreground">
          Frontier and open-source LLMs through one OpenAI-compatible endpoint. All paid models are billed
          per-token from your USD balance — or subscribe for flat-rate unlimited access.
        </p>
        {view.status === "preview" && (
          <div className="inline-flex items-center gap-2 mt-3 rounded-full border bg-amber-50 text-amber-900 px-3 py-1 text-xs">
            <Sparkles className="h-3 w-3" />
            Preview catalog · sign in to see your available models
          </div>
        )}
        {view.status === "live" && (
          <div className="inline-flex items-center gap-2 mt-3 rounded-full border bg-emerald-50 text-emerald-900 px-3 py-1 text-xs">
            <Sparkles className="h-3 w-3" />
            Live · {view.liveCount} models enabled for your account
          </div>
        )}
      </div>

      {view.status === "loading" ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Paid */}
          {view.paid.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">Premium</h2>
                <span className="text-sm text-muted-foreground">
                  {view.paid.length} models · pay-as-you-go
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {view.paid.map((m) => (
                  <ModelCard key={m.id} model={m} />
                ))}
              </div>
            </section>
          )}

          {/* Free */}
          {view.free.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xl font-semibold">Free tier</h2>
                <span className="text-sm text-muted-foreground">
                  {view.free.length} models · rate-limited, no balance required
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {view.free.map((m) => (
                  <ModelCard key={m.id} model={m} />
                ))}
              </div>
            </section>
          )}

          {/* Empty state(live=true 但所有模型都被过滤) */}
          {view.paid.length === 0 && view.free.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-sm">No models available for your account. Contact admin or check back later.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
