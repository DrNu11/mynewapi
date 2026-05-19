import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { ModelsGrid } from "@/components/models-grid";
import { PricingCards } from "@/components/pricing-cards";
import { Faq } from "@/components/faq";
import { CTA } from "@/components/cta";
import { Footer } from "@/components/footer";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <Features />
        <ModelsGrid />
        <PricingCards />
        <Faq />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
