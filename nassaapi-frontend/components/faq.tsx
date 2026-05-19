"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { FAQS } from "@/lib/constants";

export function Faq() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <section className="relative py-24 sm:py-32">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-wider uppercase text-brand-300">
            FAQ
          </p>
          <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-white [text-wrap:balance]">
            常见问题
          </h2>
        </div>

        <div className="mx-auto mt-12 max-w-3xl space-y-3">
          {FAQS.map((item, i) => {
            const open = openIdx === i;
            return (
              <div
                key={item.q}
                className={cn(
                  "rounded-xl border transition-all",
                  open
                    ? "border-brand-400/30 bg-white/[0.04]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.03]"
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  aria-expanded={open}
                >
                  <span className="text-base font-medium text-white">
                    {item.q}
                  </span>
                  {open ? (
                    <Minus className="h-5 w-5 flex-shrink-0 text-brand-300" />
                  ) : (
                    <Plus className="h-5 w-5 flex-shrink-0 text-ink-400" />
                  )}
                </button>
                {open && (
                  <div className="px-5 pb-5 text-sm text-ink-300 leading-relaxed">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
