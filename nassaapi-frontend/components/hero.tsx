import Link from "next/link";
import { ArrowRight, Sparkles, Github } from "lucide-react";
import { SITE, TRUST_BADGES } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 sm:pt-40 sm:pb-32">
      {/* Background grid + glow */}
      <div className="absolute inset-0 -z-10 bg-[size:48px_48px] bg-grid-pattern" />
      <div className="absolute inset-0 -z-10 bg-hero-glow" />
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-brand-400/40 to-transparent" />

      <div className="container-page">
        <div className="flex flex-col items-center text-center">
          <Link
            href="/pricing"
            className="group glass animate-fade-in inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm text-ink-200 hover:bg-white/[0.06] transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand-300" />
            <span>新订阅套餐已上线，月付立减 30%</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <h1 className="mt-8 max-w-4xl text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight gradient-text animate-fade-in-up [text-wrap:balance]">
            一个 API Key
            <br />
            连接全世界 AI 模型
          </h1>

          <p
            className="mt-6 max-w-2xl text-lg sm:text-xl text-ink-300 leading-relaxed animate-fade-in-up [text-wrap:balance]"
            style={{ animationDelay: "120ms" }}
          >
            {SITE.description}
          </p>

          <div
            className="mt-10 flex flex-col sm:flex-row items-center gap-3 animate-fade-in-up"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href={SITE.registerUrl}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-semibold text-ink-950 hover:bg-ink-100 transition-all hover:scale-[1.02]"
            >
              立即免费注册
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-6 py-3 text-base font-medium text-white hover:bg-white/[0.08] transition-colors"
            >
              查看定价
            </Link>
          </div>

          <div
            className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-ink-400 animate-fade-in-up"
            style={{ animationDelay: "360ms" }}
          >
            {TRUST_BADGES.map((badge) => (
              <span key={badge} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.6)]" />
                {badge}
              </span>
            ))}
          </div>
        </div>

        {/* Code preview card */}
        <div
          className="mx-auto mt-20 max-w-3xl animate-fade-in-up"
          style={{ animationDelay: "480ms" }}
        >
          <CodePreviewCard />
        </div>
      </div>
    </section>
  );
}

function CodePreviewCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-brand-500/30 via-purple-500/20 to-brand-400/30 blur-2xl opacity-60" />
      <div className="relative glass rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-500/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
            <span className="h-3 w-3 rounded-full bg-green-500/70" />
          </div>
          <span className="font-mono text-xs text-ink-400">openai-sdk · python</span>
          <span className="text-xs text-ink-500">5 分钟接入</span>
        </div>
        <pre className="overflow-x-auto px-6 py-5 text-sm leading-relaxed">
          <code className="font-mono">
            <span className="text-violet-300">from</span>
            <span className="text-ink-200"> openai </span>
            <span className="text-violet-300">import</span>
            <span className="text-ink-200"> OpenAI</span>
            {"\n\n"}
            <span className="text-ink-200">client = </span>
            <span className="text-amber-300">OpenAI</span>
            <span className="text-ink-200">(</span>
            {"\n  "}
            <span className="text-emerald-300">base_url</span>
            <span className="text-ink-200">=</span>
            <span className="text-rose-300">{`"${SITE.apiBaseUrl}/v1"`}</span>
            <span className="text-ink-200">,</span>
            {"\n  "}
            <span className="text-emerald-300">api_key</span>
            <span className="text-ink-200">=</span>
            <span className="text-rose-300">&quot;sk-xxxxxxxxxxxxxxxx&quot;</span>
            <span className="text-ink-200">,</span>
            {"\n"}
            <span className="text-ink-200">)</span>
            {"\n\n"}
            <span className="text-ink-200">resp = client.chat.completions.</span>
            <span className="text-amber-300">create</span>
            <span className="text-ink-200">(</span>
            {"\n  "}
            <span className="text-emerald-300">model</span>
            <span className="text-ink-200">=</span>
            <span className="text-rose-300">&quot;gpt-4o&quot;</span>
            <span className="text-ink-200">,</span>
            {"\n  "}
            <span className="text-emerald-300">messages</span>
            <span className="text-ink-200">=[{`{`}</span>
            <span className="text-rose-300">&quot;role&quot;</span>
            <span className="text-ink-200">: </span>
            <span className="text-rose-300">&quot;user&quot;</span>
            <span className="text-ink-200">, </span>
            <span className="text-rose-300">&quot;content&quot;</span>
            <span className="text-ink-200">: </span>
            <span className="text-rose-300">&quot;Hello!&quot;</span>
            <span className="text-ink-200">{`}]`},</span>
            {"\n"}
            <span className="text-ink-200">)</span>
          </code>
        </pre>
      </div>
    </div>
  );
}
