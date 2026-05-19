import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import type { Plan } from "@/lib/plans";
import { formatUSD } from "@/lib/utils";
import { cn } from "@/lib/utils";

const PERIOD_LABEL: Record<Plan["period"], string> = {
  day: "1 day",
  week: "1 week",
  month: "1 month",
};

export function PlanCard({ plan }: { plan: Plan }) {
  return (
    <Card
      className={cn(
        "flex flex-col transition",
        plan.highlight ? "border-brand shadow-md ring-1 ring-brand/30" : "hover:border-foreground/20"
      )}
    >
      <CardHeader className="pb-3 space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant={plan.highlight ? "default" : "outline"}>{plan.modelName}</Badge>
          {plan.highlight && <Badge variant="info">Most popular</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">Unlimited for {PERIOD_LABEL[plan.period]}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tabular-nums">{formatUSD(plan.priceUSD)}</span>
          <span className="text-sm text-muted-foreground">/ {plan.period}</span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-4">
        <ul className="space-y-2 text-sm flex-1">
          {plan.features.map((f) => (
            <li key={f} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <Button className="w-full" variant={plan.highlight ? "default" : "outline"}>
          Subscribe
        </Button>
      </CardContent>
    </Card>
  );
}
