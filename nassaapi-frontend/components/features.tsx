import {
  Zap,
  Shield,
  Wallet,
  Plug,
  Users,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { FEATURES } from "@/lib/constants";

const ICONS: Record<string, LucideIcon> = {
  Zap,
  Shield,
  Wallet,
  Plug,
  Users,
  Globe,
};

export function Features() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-wider uppercase text-brand-300">
            Why nassaapi
          </p>
          <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-white [text-wrap:balance]">
            选择我们的 6 个理由
          </h2>
          <p className="mt-4 text-lg text-ink-300 [text-wrap:balance]">
            不仅仅是 API 中转，我们提供企业级的可用性、灵活的计费和无缝的开发体验。
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = ICONS[f.icon] ?? Zap;
            return (
              <div
                key={f.title}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04] hover:border-white/20"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-brand-500/0 via-brand-500/0 to-brand-500/0 opacity-0 group-hover:from-brand-500/5 group-hover:to-purple-500/5 group-hover:opacity-100 transition-opacity" />
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 ring-1 ring-brand-500/20">
                  <Icon className="h-5 w-5 text-brand-300" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-300">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
