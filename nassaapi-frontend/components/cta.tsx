import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SITE } from "@/lib/constants";

export function CTA() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/10 via-purple-500/5 to-transparent p-10 sm:p-16">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-purple-500/15 blur-3xl" />

          <div className="relative flex flex-col items-center text-center">
            <h2 className="text-4xl sm:text-5xl font-bold tracking-tight text-white [text-wrap:balance]">
              准备好开始了吗？
            </h2>
            <p className="mt-4 max-w-xl text-lg text-ink-300 [text-wrap:balance]">
              注册即送 $0.5 体验额度。无信用卡门槛，5 分钟接入你的应用。
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
              <Link
                href={SITE.registerUrl}
                className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-semibold text-ink-950 hover:bg-ink-100 transition-all hover:scale-[1.02]"
              >
                立即免费注册
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={SITE.docsUrl}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-base font-medium text-white hover:bg-white/[0.08] transition-colors"
              >
                查看接入文档
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
