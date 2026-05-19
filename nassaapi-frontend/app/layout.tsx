import type { Metadata } from "next";
import "./globals.css";
import { SITE } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    default: `${SITE.brand} · ${SITE.tagline}`,
    template: `%s · ${SITE.brand}`,
  },
  description: SITE.description,
  keywords: [
    "AI API",
    "OpenAI 中转",
    "Claude API",
    "Gemini API",
    "DeepSeek API",
    "AI 模型聚合",
    "国内 AI API",
    SITE.brand,
  ],
  authors: [{ name: SITE.brand, url: `https://${SITE.domain}` }],
  metadataBase: new URL(`https://${SITE.domain}`),
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: `https://${SITE.domain}`,
    siteName: SITE.brand,
    title: `${SITE.brand} · ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.brand} · ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
