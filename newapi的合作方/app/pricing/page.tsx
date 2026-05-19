import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanCard } from "@/components/plan-card";
import { PLANS, TOPUP_AMOUNTS } from "@/lib/plans";
import { formatUSD } from "@/lib/utils";
import { ArrowRight, Wallet, Sparkles } from "lucide-react";

export const metadata = { title: "Pricing — Toplenged AI" };

export default function PricingPage() {
  return (
    <div className="container py-10 lg:py-12 space-y-14">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Two ways to pay</h1>
        <p className="text-muted-foreground">
          Top up <strong>USD balance</strong> for pay-as-you-go on every model — or subscribe to{" "}
          <strong>flat-rate plans</strong> for unlimited access on a specific model.
        </p>
      </div>

      {/* === Track 1: Pay-as-you-go (top up) === */}
      <section>
        <Card className="border-brand/30 bg-gradient-to-br from-brand/5 to-transparent">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand" />
              <Badge variant="info">Pay-as-you-go</Badge>
            </div>
            <h2 className="text-2xl font-semibold">Top up USD balance</h2>
            <p className="text-sm text-muted-foreground">
              Add any amount. Use it across every model on per-token billing. No expiry.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {TOPUP_AMOUNTS.map((amt) => (
                <Link
                  key={amt}
                  href={`/top-up?amount=${amt}`}
                  className="rounded-lg border bg-background p-4 text-center transition hover:border-brand hover:shadow-sm"
                >
                  <div className="text-xl font-semibold tabular-nums">{formatUSD(amt)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Top up</div>
                </Link>
              ))}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t">
              <span className="text-sm text-muted-foreground">
                ✓ All models · ✓ No expiry · ✓ Receipts via PayPal
              </span>
              <Button asChild>
                <Link href="/top-up">
                  Custom amount <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* === Track 2: Flat-rate plans === */}
      <section className="space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand" />
          <Badge>Flat-rate plans</Badge>
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold">Subscribe for unlimited access</h2>
          <p className="text-sm text-muted-foreground">
            Pick a model + duration. Predictable billing, no per-token surprises.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </section>

      {/* === FAQ === */}
      <section className="space-y-4 max-w-3xl mx-auto">
        <h2 className="text-xl font-semibold text-center">Common questions</h2>
        <div className="space-y-3">
          {[
            {
              q: "Can I mix top-up and subscription?",
              a: "Yes. Subscribed models bypass per-token billing for their duration; non-subscribed models still draw from your USD balance.",
            },
            {
              q: "Does the balance expire?",
              a: "No. Top-up balance never expires. Plans expire at the end of their period.",
            },
            {
              q: "What if a free model is rate-limited?",
              a: "Free models have shared per-IP rate limits. If hit, the request returns HTTP 429 — switch to a paid model or top up.",
            },
            {
              q: "How are refunds handled?",
              a: "Pay-as-you-go top-ups are refundable for unused balance within 14 days. Subscriptions are non-refundable but cancellable.",
            },
          ].map(({ q, a }) => (
            <div key={q} className="rounded-lg border p-4 bg-card/50">
              <div className="font-medium">{q}</div>
              <div className="text-sm text-muted-foreground mt-1">{a}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
