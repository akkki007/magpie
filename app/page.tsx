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
        <Integrations />
        <CTA />
      </main>
      <Footer />
    </>
  );
}
