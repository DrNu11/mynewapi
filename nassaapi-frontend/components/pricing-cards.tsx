import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRICING_TIERS, SITE } from "@/lib/constants";

export function PricingCards({ compact = false }: { compact?: boolean }) {
  return (
    <section
      id="pricing"
      className={cn("relative", compact ? "py-16" : "py-24 sm:py-32")}
    >
      <div className="container-page">
        {!compact && (
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-wider uppercase text-brand-300">
              Pricing
            </p>
            <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-white [text-wrap:balance]">
              简单透明，按需选择
            </h2>
            <p className="mt-4 text-lg text-ink-300 [text-wrap:balance]">
              月度订阅锁定成本，按量计费灵活付费。所有套餐都包含全部模型访问权限。
            </p>
          </div>
        )}

        <div
          className={cn(
            "mx-auto grid max-w-7xl gap-4",
            compact ? "mt-8" : "mt-16",
            "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
          )}
        >
          {PRICING_TIERS.map((tier) => (
            <div
              key={tier.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-6 transition-all",
                tier.highlight
                  ? "border-brand-400/40 bg-gradient-to-b from-brand-500/[0.08] to-brand-500/[0.02] shadow-[0_0_60px_-15px_rgba(91,133,255,.4)]"
                  : "border-white/10 bg-white/[0.02] hover:border-white/20"
              )}
            >
              {tier.highlight && tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-400 to-brand-500 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                    <Sparkles className="h-3 w-3" />
                    {tier.badge}
                  </span>
                </div>
              )}
              <div>
                <h3 className="text-xl font-semibold text-white">{tier.name}</h3>
                <p className="mt-1 text-sm text-ink-400 min-h-[2.5rem]">
                  {tier.description}
                </p>
              </div>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-white tracking-tight">
                  {tier.price}
                </span>
                <span className="text-sm text-ink-400">{tier.priceUnit}</span>
              </div>
              <p className="mt-1 text-xs text-brand-300 font-medium">
                {tier.quotaLabel}
              </p>

              <ul className="mt-6 space-y-2.5 flex-1">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2.5 text-sm text-ink-200"
                  >
                    <Check className="h-4 w-4 mt-0.5 flex-shrink-0 text-brand-400" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={SITE.registerUrl}
                className={cn(
                  "mt-6 inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition-all",
                  tier.highlight
                    ? "bg-white text-ink-950 hover:bg-ink-100"
                    : "border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                )}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center text-sm text-ink-400">
          需要更高额度或企业方案？{" "}
          <a
            href={`mailto:${SITE.email}`}
            className="text-brand-300 hover:text-brand-200 underline-offset-4 hover:underline"
          >
            联系我们
          </a>
        </p>
      </div>
    </section>
  );
}
