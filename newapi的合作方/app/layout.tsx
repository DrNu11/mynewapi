import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AuthProvider } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Toplenged AI — Premium LLMs, simple API, pay-as-you-go",
  description:
    "Access frontier and open-source LLMs through one OpenAI-compatible API. Pay-as-you-go in USD or subscribe to flat-rate plans.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex">
        <LocaleProvider>
          <AuthProvider>
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <Topbar />
              <main className="flex-1 overflow-auto">{children}</main>
            </div>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
