import { ArrowRightIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PricingSectionProps {
  hasSession: boolean;
}

export const PricingSection = ({ hasSession }: PricingSectionProps) => {
  const tiers = [
    {
      name: "Community",
      badge: "Free Forever",
      price: "$0",
      period: "forever",
      description:
        "For individual builders, hobby projects, and local self-hosting.",
      features: [
        "Up to 5 active workflows",
        "Full visual canvas & React Flow editor",
        "AES-256-GCM encrypted credential vault",
        "OpenAI, Anthropic & Gemini AI SDK nodes",
        "Google Forms & Stripe webhook triggers",
        "Real-time execution telemetry & logs",
      ],
      ctaText: hasSession ? "Current Plan" : "Start Free",
      ctaHref: hasSession ? "/workflows" : "/signup",
      highlighted: false,
    },
    {
      name: "Pro Builder",
      badge: "Most Popular",
      price: "$20",
      period: "per month",
      description:
        "For founders, engineers, and production business automations.",
      features: [
        "Unlimited active workflows",
        "Unlimited execution history & traces",
        "High-throughput Inngest step execution",
        "Unlimited webhook triggers & custom cron jobs",
        "Postgres, Airtable & HubSpot enterprise nodes",
        "Priority support & Polar customer portal",
      ],
      ctaText: hasSession ? "Upgrade to Pro" : "Start 14-Day Free Trial",
      ctaHref: hasSession ? "/workflows" : "/signup",
      highlighted: true,
    },
    {
      name: "Enterprise",
      badge: "Dedicated Scale",
      price: "Custom",
      period: "annual billing",
      description:
        "For engineering teams requiring custom connectors, SSO, and dedicated workers.",
      features: [
        "Custom private Node SDK registry & connectors",
        "Dedicated isolated worker clusters",
        "SAML / SSO & Role-Based Access Control",
        "Custom data residency & VPC peering",
        "99.99% Uptime SLA & 24/7 incident response",
        "Architecture review & migration assistance",
      ],
      ctaText: "Contact Engineering",
      ctaHref: "mailto:support@autoflow.io",
      highlighted: false,
    },
  ];

  return (
    <section id="pricing" className="border-t border-border/50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-primary text-xs"
          >
            Simple & Transparent
          </Badge>
          <h2 className="mt-3 font-bold text-3xl tracking-tight text-foreground sm:text-4xl">
            Start building for free, scale with confidence
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
            No hidden execution tax, no artificial node count limits. Powered by
            Polar billing for instant checkout and self-service subscriptions.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-3 lg:items-stretch">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col justify-between rounded-2xl border transition-all ${
                tier.highlighted
                  ? "border-primary/60 bg-card shadow-xl lg:-mt-3 lg:mb-3 lg:py-10"
                  : "border-border/80 bg-card/60 hover:border-muted-foreground/40 shadow-xs"
              }`}
            >
              {tier.highlighted && (
                <>
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground font-medium px-3 py-0.5 text-xs shadow-xs">
                      <SparklesIcon className="mr-1 size-3" />
                      {tier.badge}
                    </Badge>
                  </div>
                </>
              )}

              <div className={tier.highlighted ? "px-6 sm:px-8" : "p-6 sm:p-8"}>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg text-foreground">
                    {tier.name}
                  </h3>
                  {!tier.highlighted && (
                    <Badge
                      variant="secondary"
                      className="font-mono text-[10px]"
                    >
                      {tier.badge}
                    </Badge>
                  )}
                </div>

                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {tier.description}
                </p>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-extrabold text-4xl tracking-tight text-foreground">
                    {tier.price}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    /{tier.period}
                  </span>
                </div>

                <div className="mt-8 border-t border-border/50 pt-6">
                  <ul className="flex flex-col gap-3 text-xs text-muted-foreground">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <CheckCircle2Icon
                          className={`mt-0.5 size-3.5 shrink-0 ${
                            tier.highlighted
                              ? "text-primary"
                              : "text-primary/70"
                          }`}
                        />
                        <span
                          className={
                            tier.highlighted
                              ? "text-foreground"
                              : "text-foreground/90"
                          }
                        >
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div
                className={`${
                  tier.highlighted ? "px-6 pb-8 sm:px-8" : "p-6 sm:p-8 pt-0"
                } mt-0`}
              >
                <Button
                  asChild
                  variant={tier.highlighted ? "default" : "outline"}
                  className="w-full h-10 font-medium text-xs shadow-xs"
                >
                  <Link
                    href={tier.ctaHref}
                    className="flex items-center justify-center gap-1.5"
                  >
                    <span>{tier.ctaText}</span>
                    <ArrowRightIcon className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
