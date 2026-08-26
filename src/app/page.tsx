import {
  ArrowRightIcon,
  CreditCardIcon,
  GitBranchIcon,
  KeyRoundIcon,
  ListTreeIcon,
  SparklesIcon,
  WebhookIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";

export const metadata: Metadata = {
  title: "AutoFlow — visual automation with observable executions",
  description:
    "Build workflows on a visual canvas, run them durably, and debug every node with per-node traces.",
};

const capabilities = [
  {
    icon: GitBranchIcon,
    title: "Visual canvas",
    body: "Drag-and-drop workflow builder that saves your graph exactly as you left it.",
  },
  {
    icon: ListTreeIcon,
    title: "Durable, observable runs",
    body: "Executions survive crashes and retries; every node is traced with status, duration, and attempts — nothing fails silently.",
  },
  {
    icon: SparklesIcon,
    title: "Multi-model AI nodes",
    body: "OpenAI, Anthropic, and Gemini nodes wired through the AI SDK.",
  },
  {
    icon: WebhookIcon,
    title: "Webhook triggers",
    body: "Start workflows from Stripe events or Google Form submissions — signed and secret-checked.",
  },
  {
    icon: KeyRoundIcon,
    title: "Encrypted credentials",
    body: "API keys are encrypted at rest and decrypted only inside a run.",
  },
  {
    icon: CreditCardIcon,
    title: "Pro plan via Polar",
    body: "Checkout and customer portal handled by Polar; premium actions gated server-side.",
  },
];

const LandingPage = async () => {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Image
            src="/logos/logo.svg"
            alt="AutoFlow"
            width={28}
            height={28}
            // biome-ignore lint/a11y/noSvgWithoutTitle: decorative brand mark next to text
          />
          <span className="font-semibold">AutoFlow</span>
        </div>
        <nav className="flex items-center gap-2">
          {session ? (
            <Button asChild>
              <Link href="/workflows">
                Open dashboard <ArrowRightIcon className="size-4" />
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/signup">
                  Get started <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-14 px-6 py-20">
        <section className="flex flex-col items-center gap-5 text-center">
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
            Pre-beta · built in the open
          </span>
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Visual automation with executions you can actually debug
          </h1>
          <p className="max-w-xl text-muted-foreground">
            Design workflows node by node, run them durably, and inspect exactly
            what happened — per node, per attempt, in real time.
          </p>
          <div className="flex items-center gap-3">
            {session ? (
              <Button size="lg" asChild>
                <Link href="/workflows">
                  Open dashboard <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild>
                  <Link href="/signup">
                    Start building <ArrowRightIcon className="size-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Log in</Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="flex flex-col gap-2 rounded-lg border bg-card p-5"
            >
              <Icon className="size-5 text-primary" />
              <h2 className="font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        AutoFlow — visual workflow automation.
      </footer>
    </div>
  );
};

export default LandingPage;
