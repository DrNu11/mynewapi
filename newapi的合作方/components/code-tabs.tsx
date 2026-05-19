"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export type CodeSample = {
  label: string;
  language?: string; // 仅显示用,Tailwind 不需要
  code: string;
};

export function CodeTabs({ samples, className }: { samples: CodeSample[]; className?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = samples[active] ?? samples[0];

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 静默 — 老 Safari / 无 https 时 clipboard 不可用
    }
  }

  return (
    <div className={cn("rounded-lg border overflow-hidden bg-zinc-950", className)}>
      <div className="flex items-stretch border-b border-zinc-800 bg-zinc-900/70">
        <div className="flex flex-1 overflow-x-auto">
          {samples.map((s, i) => (
            <button
              key={s.label + i}
              onClick={() => setActive(i)}
              className={cn(
                "px-4 py-2 text-xs font-medium border-r border-zinc-800 whitespace-nowrap transition",
                i === active
                  ? "bg-zinc-950 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={onCopy}
          className="px-3 text-xs text-zinc-400 hover:text-zinc-100 flex items-center gap-1.5 border-l border-zinc-800"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="p-5 text-xs sm:text-sm overflow-x-auto font-mono leading-relaxed text-zinc-100">
        {current.code}
      </pre>
    </div>
  );
}
