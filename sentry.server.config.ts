// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: "https://f1a2853e6bb4b74c72976cd5c3b37dd9@o4507629901053952.ingest.de.sentry.io/4510150041337936",

  integrations: [
    // Add the Vercel AI SDK integration to sentry.server.config.ts
    // AF-M8-16: prompts and completions are customer data flowing through a
    // workflow (security.md §9 keeps execution IO out of support tooling by
    // default). Record that a model call happened, not what was said.
    Sentry.vercelAIIntegration({
      recordInputs: false,
      recordOutputs: false,
    }),
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // AF-M8-16: was `true`, which attaches request headers - Authorization and
  // Cookie included - to every event. security.md §9 requires them stripped.
  sendDefaultPii: false,

  // security.md §9 [HARD]: the same redaction the logger applies.
  beforeSend: scrubSentryEvent,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
