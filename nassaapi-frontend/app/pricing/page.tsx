import { Header } from "@/components/header";
import { PricingCards } from "@/components/pricing-cards";
import { Faq } from "@/components/faq";
import { CTA } from "@/components/cta";
import { Footer } from "@/components/footer";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "定价",
  description: "选择适合你的订阅套餐：Trial / Standard / Pro / Team。月度订阅锁定成本，按量计费灵活付费。",
};

export default function PricingPage() {
  return (
    <>
      <Header />
      <main className="flex-1 pt-32">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-semibold tracking-wider uppercase text-brand-300">
              Pricing
            </p>
            <h1 className="mt-3 text-5xl sm:text-6xl font-bold tracking-tight gradient-text [text-wrap:balance]">
              简单透明的订阅
            </h1>
            <p className="mt-6 text-lg text-ink-300 [text-wrap:balance]">
              月付锁定成本，按量计费灵活付费。所有套餐都包含全部模型访问权限和 OpenAI 兼容接口。
            </p>
          </div>
        </div>
        <PricingCards compact />
        <Faq />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
