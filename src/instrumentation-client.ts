// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

import { redact } from "@/lib/logger";

Sentry.init({
  dsn: "https://f1a2853e6bb4b74c72976cd5c3b37dd9@o4507629901053952.ingest.de.sentry.io/4510150041337936",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Strip secrets from every event before it leaves the browser (AF-M0-07).
  beforeSend(event) {
    if (event.extra) {
      event.extra = redact(event.extra) as typeof event.extra;
    }
    if (event.request?.data) {
      event.request.data = redact(event.request.data);
    }
    if (event.contexts) {
      event.contexts = redact(event.contexts) as typeof event.contexts;
    }
    return event;
  },

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
