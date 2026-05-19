"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TOPUP_AMOUNTS } from "@/lib/plans";
import { formatUSD, cn } from "@/lib/utils";
import { Wallet, Check, Loader2, AlertCircle } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useAuth } from "@/lib/auth";

// PayPal SDK 在 window 上挂的命名空间
declare global {
  interface Window {
    paypal?: {
      Buttons: (config: PayPalButtonsConfig) => {
        render: (container: string | HTMLElement) => Promise<void>;
        close: () => Promise<void>;
        isEligible?: () => boolean;
      };
    };
  }
}

type PayPalButtonsConfig = {
  style?: { layout?: "vertical" | "horizontal"; color?: string; shape?: string; label?: string };
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
};

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";

export default function TopUpPage() {
  return (
    <RequireAuth>
      <TopUpContent />
    </RequireAuth>
  );
}

function TopUpContent() {
  const router = useRouter();
  const { refresh } = useAuth();

  const [amount, setAmount] = useState<number>(40);
  const [custom, setCustom] = useState<string>("");
  const finalAmount = custom ? Number(custom) || 0 : amount;
  const valid = finalAmount >= 5 && finalAmount <= 5000;

  const [sdkReady, setSdkReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number } | null>(null);

  // 用 ref 锁住 PayPal Buttons 当前用的 amount(closure 防止 stale)
  const amountRef = useRef(finalAmount);
  useEffect(() => {
    amountRef.current = finalAmount;
  }, [finalAmount]);

  // 1) 加载 PayPal JS SDK(仅一次,跨 strict-mode 双 effect 用 window.paypal 自检)
  useEffect(() => {
    if (!PAYPAL_CLIENT_ID) {
      setError("PayPal not configured (NEXT_PUBLIC_PAYPAL_CLIENT_ID missing). Set it in .env.local.");
      return;
    }
    if (window.paypal) {
      setSdkReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-paypal-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", () => setSdkReady(true), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      PAYPAL_CLIENT_ID
    )}&currency=USD&intent=capture&components=buttons`;
    s.async = true;
    s.dataset.paypalSdk = "true";
    s.onload = () => setSdkReady(true);
    s.onerror = () => setError("Failed to load PayPal SDK");
    document.body.appendChild(s);
  }, []);

  // 2) SDK 加载完成后渲染按钮(只渲一次,内部用 ref 读最新 amount)
  useEffect(() => {
    if (!sdkReady || !window.paypal || success) return;
    const container = document.getElementById("paypal-buttons");
    if (!container) return;
    container.innerHTML = ""; // 清掉旧的(切金额不重渲,但万一被 React 卸载重挂)

    const btns = window.paypal.Buttons({
      style: { layout: "vertical", color: "blue", shape: "rect", label: "paypal" },

      createOrder: async () => {
        setError(null);
        setPaying(true);
        const amt = amountRef.current;
        if (!(amt >= 5 && amt <= 5000)) {
          setPaying(false);
          throw new Error("Invalid amount");
        }
        const r = await fetch("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: amt }),
        });
        const j = (await r.json()) as { success: boolean; message?: string; data?: { id: string } };
        if (!r.ok || !j.success || !j.data?.id) {
          setPaying(false);
          throw new Error(j.message || "Failed to create order");
        }
        return j.data.id;
      },

      onApprove: async (data) => {
        try {
          const r = await fetch("/api/paypal/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: data.orderID }),
          });
          const j = (await r.json()) as {
            success: boolean;
            message?: string;
            data?: { added_usd: number };
          };
          if (!r.ok || !j.success || !j.data) {
            throw new Error(j.message || "Capture failed");
          }
          setSuccess({ amount: j.data.added_usd });
          // 刷新 auth context 拿新余额
          refresh().catch(() => {});
        } catch (err) {
          setError(err instanceof Error ? err.message : "Capture failed");
        } finally {
          setPaying(false);
        }
      },

      onCancel: () => {
        setPaying(false);
      },
      onError: (err) => {
        setPaying(false);
        setError(err instanceof Error ? err.message : "PayPal error");
      },
    });

    btns.render("#paypal-buttons").catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to render PayPal buttons");
    });

    return () => {
      btns.close().catch(() => {});
    };
  }, [sdkReady, success, refresh]);

  // 成功态:整页替换为确认信息
  if (success) {
    return (
      <div className="container py-10 lg:py-12 max-w-2xl">
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-semibold">Top-up successful</h2>
            <p className="text-muted-foreground">
              {formatUSD(success.amount)} added to your balance.
            </p>
            <div className="flex gap-3 justify-center pt-4">
              <Button onClick={() => router.push("/dashboard")}>Go to dashboard</Button>
              <Button variant="outline" onClick={() => setSuccess(null)}>
                Top up again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-10 lg:py-12 max-w-3xl">
      <div className="space-y-2 mb-8">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Wallet className="h-4 w-4" /> Top up
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Add USD to your balance</h1>
        <p className="text-muted-foreground">
          Pay-as-you-go on every model. No expiry. Refundable within 14 days for unused balance.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: amount selection */}
        <Card>
          <CardHeader className="pb-4">
            <h2 className="font-semibold">Choose amount</h2>
            <p className="text-xs text-muted-foreground">Min $5 · Max $5,000 per top-up</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {TOPUP_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => {
                    setAmount(amt);
                    setCustom("");
                  }}
                  className={cn(
                    "rounded-lg border p-4 text-center transition",
                    !custom && amount === amt
                      ? "border-brand bg-brand/5 ring-1 ring-brand"
                      : "hover:border-foreground/40"
                  )}
                >
                  <div className="text-xl font-semibold tabular-nums">{formatUSD(amt)}</div>
                  {amt === 40 && (
                    <Badge variant="info" className="mt-1.5 text-[10px]">
                      Most popular
                    </Badge>
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Or enter custom amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <input
                  type="number"
                  min={5}
                  max={5000}
                  step={1}
                  placeholder="40"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className="w-full rounded-md border bg-background pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </div>
            </div>

            <ul className="space-y-2 text-sm pt-2">
              {[
                "Use balance across all models",
                "Per-token billing — only pay what you use",
                "Balance never expires",
                "Receipts auto-emailed via PayPal",
              ].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Right: order summary + PayPal buttons */}
        <Card className="h-fit lg:sticky lg:top-20">
          <CardHeader className="pb-4">
            <h2 className="font-semibold">Order summary</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Top-up amount</span>
                <span className="tabular-nums">{formatUSD(finalAmount || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Processing fee</span>
                <span className="tabular-nums">$0.00</span>
              </div>
              <div className="flex justify-between font-semibold pt-2 border-t">
                <span>Total</span>
                <span className="tabular-nums">{formatUSD(finalAmount || 0)}</span>
              </div>
            </div>

            {/* PayPal Buttons 渲染区 */}
            <div className="pt-2">
              {!PAYPAL_CLIENT_ID ? (
                <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <AlertCircle className="h-3.5 w-3.5" /> PayPal not configured
                  </div>
                  <p>
                    Set <code className="font-mono">NEXT_PUBLIC_PAYPAL_CLIENT_ID</code> in{" "}
                    <code className="font-mono">.env.local</code> and restart dev server.
                  </p>
                </div>
              ) : !sdkReady ? (
                <div className="flex items-center justify-center py-4 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">Loading PayPal…</span>
                </div>
              ) : !valid ? (
                <Button className="w-full" size="lg" disabled>
                  Enter $5–$5,000 to continue
                </Button>
              ) : (
                <div id="paypal-buttons" className={paying ? "opacity-60 pointer-events-none" : ""} />
              )}

              {error && (
                <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground pt-1">
              Secure checkout via PayPal · We never store your card details. By proceeding you agree to our{" "}
              <a className="underline" href="#">
                Terms
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
