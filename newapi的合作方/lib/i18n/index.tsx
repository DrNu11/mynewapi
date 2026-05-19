"use client";

// 轻量 i18n — 零依赖,~80 行
//
// 设计:
//   - 默认 locale 'en'(SSR 安全,避免 hydration mismatch)
//   - mount 后从 localStorage / navigator.language 检测真实 locale,setState 切换
//   - setLocale 同时写 localStorage + 同步 <html lang>(用于 SEO 和无障碍)
//   - t(key, vars?) 找不到 key 时 fallback 到 key 本身(渐进式翻译友好)

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type TranslationKey } from "./locales/en";
import { zh } from "./locales/zh";

export type Locale = "en" | "zh";

export const LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: "en", label: "English" },
  { code: "zh", label: "简体中文" },
];

const DICTS: Record<Locale, Record<string, string>> = { en, zh };

const LOCALE_STORAGE_KEY = "toplenged_locale";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey | string, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (k) => String(k),
});

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`
  );
}

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    // localStorage 可能在隐私模式下抛错
  }
  const browser = (window.navigator?.language || "").toLowerCase();
  return browser.startsWith("zh") ? "zh" : "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // mount 后检测真实 locale(SSR 期间已用 'en' 渲染,避免 hydration mismatch)
  useEffect(() => {
    const detected = detectInitialLocale();
    setLocaleState(detected);
    if (typeof document !== "undefined") {
      document.documentElement.lang = detected === "zh" ? "zh-CN" : "en";
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey | string, vars?: Record<string, string | number>): string => {
      const dict = DICTS[locale];
      const tpl = dict[key as string] ?? (en as Record<string, string>)[key as string] ?? String(key);
      return interpolate(tpl, vars);
    },
    [locale]
  );

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  return useContext(LocaleContext);
}
