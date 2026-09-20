import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import {
  TrustStrip,
  UseCases,
  ModellingShowcase,
  Features,
  Agents,
  Integrations,
  CTA,
} from "@/components/landing/sections";
import { Architecture } from "@/components/landing/architecture";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <TrustStrip />
        <ModellingShowcase />
        <UseCases />
        <Features />
        <Agents />
        <Architecture />
        <Integrations />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
