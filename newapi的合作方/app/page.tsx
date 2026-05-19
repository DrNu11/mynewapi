import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModelCard } from "@/components/model-card";
import { MODELS, getPaidModels } from "@/lib/models";
import { ArrowRight, Code, CreditCard, Layers, ShieldCheck, Zap } from "lucide-react";

export default function HomePage() {
  const featured = MODELS.slice(0, 6);

  return (
    <div className="container py-10 lg:py-16 space-y-20">
      {/* Hero */}
      <section className="space-y-6 text-center max-w-3xl mx-auto">
        <Badge variant="info" className="mx-auto w-fit">
          <Zap className="h-3 w-3 mr-1" /> OpenAI-compatible API
        </Badge>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          One API.{" "}
          <span className="bg-gradient-to-r from-brand to-violet-600 bg-clip-text text-transparent">
            Every frontier model.
          </span>
        </h1>
        <p className="text-lg text-muted-foreground">
          Pay-as-you-go in USD or subscribe to flat-rate plans. Sonnet, GPT-5.5, DeepSeek and 5 free
          open-source models — through one endpoint, billed transparently.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/signup">
              Start free <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/docs">View docs</Link>
          </Button>
        </div>
        <div className="text-xs text-muted-foreground pt-4">
          No credit card required for free tier · Cancel anytime · 99.9% uptime SLA
        </div>
      </section>

      {/* Trust strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
        {[
          { icon: Code, label: "OpenAI-compatible" },
          { icon: Layers, label: "8+ models, 1 API" },
          { icon: CreditCard, label: "USD pay-as-you-go" },
          { icon: ShieldCheck, label: "99.9% uptime SLA" },
        ].map(({ icon: Icon, label }) => (
          <div key={label} className="flex items-center gap-3 p-4 rounded-lg border bg-card/50">
            <Icon className="h-5 w-5 text-brand shrink-0" />
            <span className="text-sm font-medium">{label}</span>
          </div>
        ))}
      </section>

      {/* Models preview */}
      <section className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">Models</h2>
            <p className="text-muted-foreground text-sm mt-1">
              {getPaidModels().length} premium &amp; {MODELS.length - getPaidModels().length} free models · single
              OpenAI-compatible endpoint
            </p>
          </div>
          <Button asChild variant="ghost">
            <Link href="/models">
              All models <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featured.map((m) => (
            <ModelCard key={m.id} model={m} />
          ))}
        </div>
      </section>

      {/* Quickstart code preview */}
      <section className="max-w-3xl mx-auto space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight text-center">Drop-in OpenAI replacement</h2>
        <pre className="rounded-lg border bg-zinc-950 text-zinc-100 p-5 text-sm overflow-x-auto font-mono leading-relaxed">
{`curl https://api.toplenged.com/v1/chat/completions \\
  -H "Authorization: Bearer $TOPLENGED_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
        </pre>
        <div className="text-center">
          <Button asChild variant="outline">
            <Link href="/docs">Full quickstart →</Link>
          </Button>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="rounded-2xl border bg-gradient-to-br from-brand/5 to-violet-500/5 p-8 md:p-12 text-center space-y-4">
        <h2 className="text-2xl md:text-3xl font-semibold">Two ways to pay. Your choice.</h2>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Top up <strong>USD balance</strong> for pay-as-you-go on every model, or subscribe to{" "}
          <strong>flat-rate plans</strong> for unlimited daily / weekly / monthly access.
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/top-up">Top up balance</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/pricing">View plans</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
