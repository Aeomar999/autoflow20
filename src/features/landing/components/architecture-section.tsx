import {
  ActivityIcon,
  CheckCircle2Icon,
  Code2Icon,
  CpuIcon,
  LockIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const ArchitectureSection = () => {
  const pillars = [
    {
      icon: CpuIcon,
      index: "01",
      badge: "Durable Orchestration",
      title: "Crash-Proof Step Execution",
      description:
        "Workflows compile to a topological DAG and run as durable Inngest steps. If a 3rd-party API drops or rate-limits, only that step retries with exponential backoff — your upstream nodes never re-execute.",
      highlights: [
        "Topological sorting with strict DAG cycle detection",
        "Step-level memoization & automatic backoff retries",
        "Deterministic replay without re-billing AI tokens",
      ],
    },
    {
      icon: LockIcon,
      index: "02",
      badge: "Cryptographic Vault",
      title: "Envelope-Encrypted Secrets",
      description:
        "API keys, OAuth tokens, and database connection strings are encrypted at rest with AES-256-GCM using per-record data encryption keys (DEK). Decryption happens at a single runtime injection point.",
      highlights: [
        "Zero plaintext read path in database or API",
        "Credentials automatically stripped from execution traces & logs",
        "Tenant-scoped key isolation and credential revocation",
      ],
    },
    {
      icon: ActivityIcon,
      index: "03",
      badge: "Real-time Telemetry",
      title: "Zero Silent Failures",
      description:
        "Every node run captures exact timestamps, latencies, input payloads, output responses, and error traces. Real-time channels stream node statuses directly to the canvas as they execute.",
      highlights: [
        "Per-node IO inspection with deep JSON diffing",
        "Realtime SSE status indicators on live canvas nodes",
        "Immediate alert dispatch on unrecoverable step failure",
      ],
    },
    {
      icon: Code2Icon,
      index: "04",
      badge: "Developer SDK",
      title: "Isomorphic, Type-Safe Node SDK",
      description:
        "Every node is defined with strict Zod schemas. Node definitions are isomorphic (client-safe for forms & palettes), while executors are strictly server-only with zero runtime leaks.",
      highlights: [
        "Single Zod schema powers UI forms, canvas validation & engine",
        "Isomorphic manifest keeps client bundle ultra-lean",
        "Handlebars expressions evaluated with AST safety",
      ],
    },
  ];

  const [featured, ...rest] = pillars;

  return (
    <section
      id="architecture"
      className="relative border-t border-border/50 bg-muted/20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex max-w-3xl flex-col items-start gap-3">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-primary text-xs"
          >
            Engine Architecture
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Engineered for reliability, not demoware
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground">
            Most workflow builders fail silently in production when APIs time
            out or keys rotate. AutoFlow is built from the ground up with
            durable execution, zero-leak secrets, and deep observability.
          </p>
        </div>

        {/* Featured pillar — spans the full width, breaks the uniform grid */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card p-6 shadow-sm transition-all hover:border-primary/60 hover:shadow-md sm:p-8 lg:col-span-3">
            <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-xl">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
                    <featured.icon className="size-5" />
                  </div>
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] text-muted-foreground"
                  >
                    {featured.badge}
                  </Badge>
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-foreground">
                  {featured.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {featured.description}
                </p>
              </div>
              <div className="flex flex-col gap-2 lg:min-w-[320px]">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Guardrails
                </span>
                <ul className="flex flex-col gap-2.5 text-xs text-muted-foreground">
                  {featured.highlights.map((highlight) => (
                    <li key={highlight} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-4 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <CheckCircle2Icon className="size-3" />
                      </span>
                      <span className="text-foreground/90">{highlight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Remaining pillars — single accent, numbered */}
          {rest.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs transition-all hover:border-primary/40 hover:shadow-md sm:p-7"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <span className="font-mono text-xs text-muted-foreground/50">
                      {pillar.index}
                    </span>
                  </div>

                  <h3 className="mt-5 font-semibold text-lg tracking-tight text-foreground">
                    {pillar.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {pillar.description}
                  </p>
                </div>

                <div className="mt-6 border-t border-border/50 pt-5">
                  <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
                    {pillar.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2">
                        <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="text-foreground/90">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
