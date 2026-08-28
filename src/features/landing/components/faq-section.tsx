import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

export const FAQSection = () => {
  const faqs = [
    {
      q: "How does AutoFlow handle API rate limits, timeouts, and worker crashes?",
      a: "AutoFlow executes workflows through an Inngest durable step engine with topological graph compilation. Each node runs as an isolated step (`step.run`). If an external API (such as OpenAI or HubSpot) times out or hits a 429 rate limit, only that individual step retries with exponential backoff. Completed upstream nodes are memoized and never re-executed, preventing duplicate billing and duplicate webhook actions.",
    },
    {
      q: "Where are my API credentials stored, and can they leak into logs or traces?",
      a: "All credentials are encrypted at rest using AES-256-GCM envelope encryption with per-record Data Encryption Keys (DEKs). There is zero plaintext read path in the database or REST APIs. Credential values are decrypted only at the exact point of execution injection (`resolveNodeCredentials`) and are strictly excluded from execution trace logs, step snapshots, and client payloads.",
    },
    {
      q: "Can I orchestrate multiple AI models (Anthropic, OpenAI, Gemini) in one workflow?",
      a: "Yes. AutoFlow utilizes AI SDK v5 across Claude 3.5 Sonnet, GPT-4o, and Gemini 2.5 Flash. You can seamlessly route inputs from a trigger into Claude for reasoning, pass structured JSON output into Gemini for fast summarization, and branch based on model confidence scores.",
    },
    {
      q: "How does canvas persistence and optimistic concurrency work?",
      a: "Every canvas change tracks graph revisions with debounced autosaving. Workflows are saved transactionally to PostgreSQL with optimistic concurrency guards. If two browser tabs attempt to modify the same graph simultaneously, conflicts are detected and resolved gracefully.",
    },
    {
      q: "Can I write custom nodes for proprietary internal APIs?",
      a: "Yes. AutoFlow features an isomorphic Node SDK. You define a Zod `configSchema` and metadata in `definition.ts` (safe for browser forms & the node palette), and implement the execution logic in a `server-only` `execute.ts` file with standard TypeScript.",
    },
    {
      q: "How are webhooks authenticated and signed?",
      a: "Webhook triggers support cryptographic verification. Stripe triggers verify `stripe-signature` headers against the encrypted signing secret with HMAC-SHA256, and Google Form triggers enforce token matching. Unsigned or invalid requests are rejected at the edge.",
    },
  ];

  return (
    <section
      id="faq"
      className="border-t border-border/50 bg-muted/20 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <Badge
            variant="outline"
            className="border-primary/30 bg-primary/5 text-primary text-xs"
          >
            Frequently Asked Questions
          </Badge>
          <h2 className="mt-3 font-bold text-3xl tracking-tight text-foreground sm:text-4xl">
            Everything you need to know
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            Clear, transparent answers on architecture, durability, secrets, and
            extensibility.
          </p>
        </div>

        <div className="mt-12">
          <Accordion type="single" collapsible className="w-full space-y-3">
            {faqs.map((faq) => (
              <AccordionItem
                key={faq.q}
                value={faq.q}
                className="rounded-xl border border-border/80 bg-card px-5 shadow-2xs"
              >
                <AccordionTrigger className="text-sm font-semibold text-foreground hover:no-underline hover:text-primary transition-colors py-4">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-xs leading-relaxed text-muted-foreground pb-4">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};
