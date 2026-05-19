import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ModelInfo } from "@/lib/models";
import { cn } from "@/lib/utils";

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "bg-orange-100 text-orange-700",
  OpenAI: "bg-emerald-100 text-emerald-700",
  DeepSeek: "bg-violet-100 text-violet-700",
  Alibaba: "bg-amber-100 text-amber-700",
  Meta: "bg-blue-100 text-blue-700",
  "Zhipu AI": "bg-cyan-100 text-cyan-700",
  "01.AI": "bg-pink-100 text-pink-700",
  MiniMax: "bg-rose-100 text-rose-700",
};

export function ModelCard({ model }: { model: ModelInfo }) {
  const isPaid = model.tier === "paid";
  const providerColor = PROVIDER_COLORS[model.provider] ?? "bg-gray-100 text-gray-700";

  return (
    <Card className="hover:border-foreground/20 transition group overflow-hidden">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-lg font-bold text-sm shrink-0",
                providerColor
              )}
            >
              {model.provider.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="font-semibold leading-tight">{model.name}</div>
              <div className="text-xs text-muted-foreground">{model.provider}</div>
            </div>
          </div>
          {model.badge && (
            <Badge variant={isPaid ? "default" : "secondary"} className="shrink-0">
              {model.badge}
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground line-clamp-2">{model.description}</p>

        <div className="flex flex-wrap gap-1.5">
          {model.capability.map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] uppercase tracking-wider">
              {c}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">{model.contextK}K context</span>
          {isPaid ? (
            <span className="text-sm font-medium tabular-nums">
              <span className="text-muted-foreground">$</span>
              {model.priceIn}
              <span className="text-xs text-muted-foreground"> in</span>
              {" / "}
              <span className="text-muted-foreground">$</span>
              {model.priceOut}
              <span className="text-xs text-muted-foreground"> out / 1M</span>
            </span>
          ) : (
            <Badge variant="success">Free</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
