import type { ErrorEvent } from "@sentry/nextjs";

import { redact } from "@/lib/logger";

/**
 * Scrub a Sentry event before it leaves the process (AF-M8-16).
 *
 * `docs/architecture/security.md` §9 makes this [HARD]: Sentry's `beforeSend`
 * applies the same redaction as the logger, and request bodies and headers are
 * stripped. The browser config carried its own inline version from AF-M0-07;
 * the server and edge configs had none at all, which is where credentials,
 * webhook payloads, and node execution IO actually live.
 *
 * `headers` and `cookies` are dropped outright rather than redacted key by
 * key. A header allowlist is a thing to maintain and get wrong, and no header
 * is worth a credential leak - the URL, method, and status are what a stack
 * trace gets read with.
 */
export const scrubSentryEvent = (event: ErrorEvent): ErrorEvent => {
  if (event.extra) {
    event.extra = redact(event.extra) as ErrorEvent["extra"];
  }

  if (event.contexts) {
    event.contexts = redact(event.contexts) as ErrorEvent["contexts"];
  }

  if (event.request) {
    if (event.request.data !== undefined) {
      event.request.data = redact(event.request.data);
    }
    // Authorization, Cookie, and any provider token ride here.
    event.request.headers = undefined;
    event.request.cookies = undefined;
  }

  // Identify the user, do not profile them. `sendDefaultPii` is off, but an
  // integration can still attach an address.
  if (event.user) {
    event.user = { id: event.user.id };
  }

  return event;
};
