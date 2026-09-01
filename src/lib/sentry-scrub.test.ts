import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import { REDACTED } from "./logger";
import { scrubSentryEvent } from "./sentry-scrub";

const event = (overrides: Partial<ErrorEvent> = {}): ErrorEvent =>
  ({ type: undefined, ...overrides }) as ErrorEvent;

describe("scrubSentryEvent", () => {
  it("redacts sensitive keys in extra at any depth", () => {
    const scrubbed = scrubSentryEvent(
      event({
        extra: {
          workflowId: "wf_1",
          nested: { apiKey: "sk-live-123", note: "keep" },
        },
      }),
    );

    expect(scrubbed.extra).toEqual({
      workflowId: "wf_1",
      nested: { apiKey: REDACTED, note: "keep" },
    });
  });

  it("redacts sensitive keys in contexts", () => {
    const scrubbed = scrubSentryEvent(
      event({
        contexts: { node: { credential: "plaintext", type: "HTTP_REQUEST" } },
      }),
    );

    expect(scrubbed.contexts?.node).toEqual({
      credential: REDACTED,
      type: "HTTP_REQUEST",
    });
  });

  it("strips request headers and cookies outright", () => {
    const scrubbed = scrubSentryEvent(
      event({
        request: {
          url: "https://app.example/api/v1/workflows",
          method: "GET",
          headers: { authorization: "Bearer af_live_secret" },
          cookies: { session: "abc" },
        },
      }),
    );

    expect(scrubbed.request?.headers).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    // The parts a stack trace is actually read with survive.
    expect(scrubbed.request?.url).toBe("https://app.example/api/v1/workflows");
    expect(scrubbed.request?.method).toBe("GET");
  });

  it("redacts a request body rather than dropping it", () => {
    const scrubbed = scrubSentryEvent(
      event({
        request: { data: { name: "My workflow", token: "leaked" } },
      }),
    );

    expect(scrubbed.request?.data).toEqual({
      name: "My workflow",
      token: REDACTED,
    });
  });

  it("reduces the user to an id", () => {
    const scrubbed = scrubSentryEvent(
      event({
        user: {
          id: "user_1",
          email: "someone@example.com",
          ip_address: "203.0.113.4",
        },
      }),
    );

    expect(scrubbed.user).toEqual({ id: "user_1" });
  });

  it("leaves an event with nothing sensitive untouched", () => {
    const scrubbed = scrubSentryEvent(event({ extra: { count: 3 } }));

    expect(scrubbed.extra).toEqual({ count: 3 });
  });

  it("handles an empty event", () => {
    expect(() => scrubSentryEvent(event())).not.toThrow();
  });
});
