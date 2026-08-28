import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  CpuIcon,
  LockIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InteractiveCanvasPreview } from "./interactive-canvas-preview";

interface HeroSectionProps {
  hasSession: boolean;
}

export const HeroSection = ({ hasSession }: HeroSectionProps) => {
  return (
    <section className="relative overflow-hidden pt-14 pb-20 md:pt-20 md:pb-28">
      {/* Background glow — single accent, restrained */}
      <div className="pointer-events-none absolute -top-40 left-1/3 -z-10 h-[420px] w-[720px] -translate-x-1/2 select-none rounded-full bg-primary/20 blur-3xl dark:bg-primary/10" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="reveal-rise max-w-3xl">
          {/* Release Pill */}
          <Link
            href="#simulator"
            className="group inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="flex size-2 rounded-full bg-primary animate-pulse" />
            <span className="font-medium text-foreground">
              AutoFlow Engine v0.4.0
            </span>
            <span className="text-border">|</span>
            <span className="hidden sm:inline">
              Durable Inngest DAG Execution & Envelope Vault
            </span>
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>

          {/* Hero Title & Pitch — asymmetric, left-aligned */}
          <h1 className="mt-7 text-4xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Visual workflow automation with executions you can{" "}
            <span className="text-primary">actually inspect &amp; debug</span>
          </h1>

          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Build resilient backend graphs on a visual canvas, run them durably
            with step-level retries and cryptographic credential isolation, and
            trace every payload in real time.
          </p>

          {/* Action CTAs */}
          <div className="mt-8 flex flex-wrap items-center gap-3.5">
            {hasSession ? (
              <Button size="lg" asChild className="h-11 px-6 shadow-sm">
                <Link href="/workflows" className="flex items-center gap-2">
                  <span>Open Studio Dashboard</span>
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild className="h-11 px-6 shadow-sm">
                  <Link href="/signup" className="flex items-center gap-2">
                    <span>Start Building Free</span>
                    <ArrowRightIcon className="size-4" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-11 px-6"
                >
                  <a href="#simulator" className="flex items-center gap-2">
                    <span>Try Live Simulator</span>
                  </a>
                </Button>
              </>
            )}
          </div>

          {/* Trust & Proof Ribbon — single accent, mono, left-aligned */}
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border/60 pt-6 font-mono text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckIcon className="size-3.5 text-primary" />
              <span>Zero Silent Failures</span>
            </div>
            <div className="flex items-center gap-1.5">
              <LockIcon className="size-3.5 text-primary" />
              <span>AES-256-GCM Envelope Vault</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CpuIcon className="size-3.5 text-primary" />
              <span>Inngest Durable DAG</span>
            </div>
            <div className="flex items-center gap-1.5">
              <SparklesIcon className="size-3.5 text-primary" />
              <span>Claude + GPT-4o + Gemini</span>
            </div>
          </div>
        </div>

        {/* Live Interactive Simulator Section */}
        <div className="reveal-rise reveal-rise-delay-2 mt-14">
          <InteractiveCanvasPreview />
        </div>
      </div>
    </section>
  );
};
