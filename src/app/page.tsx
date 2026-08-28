import type { Metadata } from "next";
import { headers } from "next/headers";
import { ArchitectureSection } from "@/features/landing/components/architecture-section";
import { CodeShowcase } from "@/features/landing/components/code-showcase";
import { FAQSection } from "@/features/landing/components/faq-section";
import { HeroSection } from "@/features/landing/components/hero-section";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { NodeEcosystem } from "@/features/landing/components/node-ecosystem";
import { PricingSection } from "@/features/landing/components/pricing-section";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "AutoFlow — Visual Automation with Inspectable Executions",
  description:
    "Design workflows on a visual canvas, run them durably with Inngest step orchestration, and debug every node with per-attempt execution traces and zero-leak secrets.",
  keywords: [
    "workflow automation",
    "visual DAG editor",
    "durable execution",
    "Inngest",
    "AI orchestration",
    "Claude 3.5 Sonnet",
    "GPT-4o",
    "Gemini",
    "developer tools",
  ],
};

export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const hasSession = Boolean(session?.user);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
      {/* Sticky Glassmorphic Header */}
      <LandingHeader hasSession={hasSession} />

      {/* Main Content Sections */}
      <main className="flex-1">
        <HeroSection hasSession={hasSession} />
        <ArchitectureSection />
        <NodeEcosystem />
        <CodeShowcase />
        <PricingSection hasSession={hasSession} />
        <FAQSection />
      </main>

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
