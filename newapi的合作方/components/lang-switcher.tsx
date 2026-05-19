"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { LOCALES, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LangSwitcher() {
  const { locale, setLocale, t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("lang.label")}
        title={t("lang.label")}
        className={cn(
          "h-9 w-9 inline-flex items-center justify-center rounded-md transition",
          open ? "bg-accent" : "hover:bg-accent/60"
        )}
      >
        <Globe className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-md border bg-popover text-popover-foreground shadow-md py-1 min-w-[150px] z-50"
          role="menu"
        >
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <button
                key={l.code}
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                role="menuitem"
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2 hover:bg-accent transition",
                  active && "font-medium"
                )}
              >
                <span>{l.label}</span>
                {active && <Check className="h-3.5 w-3.5 text-brand" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
