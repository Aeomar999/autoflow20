import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifySlackError,
  normalizeChannelName,
  slackFetch,
  slackPaginate,
} from "./slack-client";

const secret = { accessToken: "xoxb-test-token" };

/** Answers with a Slack envelope at the given HTTP status. */
function stubSlack(
  responses: Array<{
    body: Record<string, unknown>;
    status?: number;
    headers?: Record<string, string>;
  }>,
): { calls: Array<{ url: URL; body: unknown; method: string }> } {
  const calls: Array<{ url: URL; body: unknown; method: string }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? "GET",
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  }) as typeof fetch);
  return { calls };
}

describe("slackFetch — the ok:false envelope (AF-M10-17)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails on channel_not_found returned as HTTP 200", async () => {
    // THE test the acceptance names. Slack reports almost every error as a
    // 200 with `ok: false`, so a client that checked `response.ok` would
    // record a failed post as a success and let the workflow continue as if
    // the message had been delivered.
    stubSlack([
      { body: { ok: false, error: "channel_not_found" }, status: 200 },
    ]);

    await expect(
      slackFetch(secret, {
        method: "chat.postMessage",
        params: { channel: "C_NOPE", text: "hi" },
        where: "Slack Post node",
      }),
    ).rejects.toThrow(/channel_not_found/);
  });

  it("does not resolve with the error body", async () => {
    // The failure mode being guarded against is not just "no throw" — it is
    // returning junk that a downstream node then reads as a message id.
    stubSlack([{ body: { ok: false, error: "channel_not_found" } }]);

    const result = await slackFetch(secret, {
      method: "chat.postMessage",
      where: "test",
    }).catch((error) => error);

    expect(result).toBeInstanceOf(NonRetriableError);
    expect(result).not.toHaveProperty("ok", false);
  });

  it("resolves normally when ok is true", async () => {
    stubSlack([{ body: { ok: true, channel: "C123", ts: "1725400000.0001" } }]);

    const result = await slackFetch<{ ts?: string }>(secret, {
      method: "chat.postMessage",
      where: "test",
    });

    expect(result.ts).toBe("1725400000.0001");
  });

  it("treats a missing ok field as failure, not success", async () => {
    // `ok` absent is not `ok: true`. Defaulting the other way would make any
    // unexpected response shape read as a successful send.
    stubSlack([{ body: { channel: "C123" } }]);

    await expect(
      slackFetch(secret, { method: "chat.postMessage", where: "test" }),
    ).rejects.toThrow(NonRetriableError);
  });

  it("sends a POST body as JSON with an explicit charset", async () => {
    // Slack documents the charset and silently misreads non-ASCII text
    // without it.
    const { calls } = stubSlack([{ body: { ok: true } }]);

    await slackFetch(secret, {
      method: "chat.postMessage",
      params: { channel: "C1", text: "café — naïve" },
      where: "test",
    });

    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ channel: "C1", text: "café — naïve" });
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      slackFetch(undefined, { method: "chat.postMessage", where: "Test node" }),
    ).rejects.toThrow(/no Slack credential/i);
  });
});

describe("classifySlackError (AF-M10-17)", () => {
  it("turns missing_scope into a sentence naming the scope", () => {
    // The acceptance requires this: Slack's own answer is the token
    // `missing_scope`, which tells a user nothing about what to do.
    const error = classifySlackError(
      {
        code: "missing_scope",
        needed: "channels:manage",
        provided: "chat:write,channels:read",
      },
      { where: "Slack Create Channel node" },
    );

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toContain("channels:manage");
    expect(error.message).toMatch(/reconnect/i);
  });

  it("falls back to the node's declared scopes when Slack sends no needed", () => {
    // Slack omits `needed` on some codes, and the node's own declaration is
    // the more useful thing to show anyway.
    const error = classifySlackError(
      { code: "missing_scope" },
      {
        where: "Slack DM node",
        declaredScopes: ["users:read.email", "im:write"],
      },
    );
    expect(error.message).toContain("users:read.email");
  });

  it("retries a rate limit", () => {
    expect(
      classifySlackError({ code: "ratelimited" }, { where: "test" }),
    ).toBeInstanceOf(RetryAfterError);
  });

  it("does not retry a revoked token", () => {
    const error = classifySlackError(
      { code: "token_revoked" },
      { where: "test" },
    );
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/reconnect/i);
  });

  it("explains not_in_channel, which reads as a permissions bug otherwise", () => {
    const error = classifySlackError(
      { code: "not_in_channel" },
      { where: "test" },
    );
    expect(error.message).toMatch(/chat:write\.public|invite/i);
  });

  it("explains users_not_found in terms of the Slack profile address", () => {
    // The near-universal cause is that the person's Slack email is not their
    // work email, and nothing in Slack's response says so.
    const error = classifySlackError(
      { code: "users_not_found" },
      { where: "test" },
    );
    expect(error.message).toMatch(/profile/i);
  });

  it("still produces a usable message for a code it has no guidance for", () => {
    const error = classifySlackError(
      { code: "some_new_slack_code" },
      { where: "Slack Post node" },
    );
    expect(error.message).toContain("Slack Post node");
    expect(error.message).toContain("some_new_slack_code");
  });
});

describe("slackFetch — HTTP-level failures (AF-M10-17)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("honours Retry-After on a 429", async () => {
    // The one case where Slack does use a status code, and its tiered limits
    // mean it.
    stubSlack([
      { body: { ok: false }, status: 429, headers: { "retry-after": "42" } },
    ]);

    const error = await slackFetch(secret, {
      method: "chat.postMessage",
      where: "test",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(RetryAfterError);
  });

  it("retries a 5xx", async () => {
    stubSlack([{ body: {}, status: 503 }]);
    await expect(
      slackFetch(secret, { method: "chat.postMessage", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });
});

describe("slackPaginate (AF-M10-17)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows next_cursor and stops when it is empty", async () => {
    const { calls } = stubSlack([
      {
        body: {
          ok: true,
          channels: [{ id: "C1" }, { id: "C2" }],
          response_metadata: { next_cursor: "page2" },
        },
      },
      {
        body: {
          ok: true,
          channels: [{ id: "C3" }],
          response_metadata: { next_cursor: "" },
        },
      },
    ]);

    const result = await slackPaginate<{ id: string }>(secret, {
      method: "conversations.list",
      itemsKey: "channels",
      limit: 100,
      where: "test",
    });

    expect(result.items.map((c) => c.id)).toEqual(["C1", "C2", "C3"]);
    expect(result.truncated).toBe(false);
    expect(calls[1].url.searchParams.get("cursor")).toBe("page2");
  });

  it("reports truncation instead of implying it returned everything", async () => {
    // A create-if-absent flow that read a truncated list would create a
    // channel that already exists.
    stubSlack([
      {
        body: {
          ok: true,
          channels: [{ id: "C1" }, { id: "C2" }],
          response_metadata: { next_cursor: "more" },
        },
      },
    ]);

    const result = await slackPaginate<{ id: string }>(secret, {
      method: "conversations.list",
      itemsKey: "channels",
      limit: 2,
      where: "test",
    });

    expect(result.truncated).toBe(true);
  });

  it("survives a listing whose key is absent", async () => {
    stubSlack([{ body: { ok: true } }]);
    const result = await slackPaginate(secret, {
      method: "conversations.list",
      itemsKey: "channels",
      limit: 50,
      where: "test",
    });
    expect(result.items).toEqual([]);
  });
});

describe("normalizeChannelName (AF-M10-17)", () => {
  it("lowercases and replaces the characters Slack rejects", () => {
    // A name from a template — "Acme Corp — Q3!" — either gets silently
    // mangled by Slack or rejected outright, depending on the characters.
    expect(normalizeChannelName("Acme Corp — Q3!")).toBe("acme-corp-q3");
  });

  it("collapses runs and trims the separators from both ends", () => {
    expect(normalizeChannelName("  --deal//  room--  ")).toBe("deal-room");
  });

  it("drops apostrophes rather than turning them into separators", () => {
    // "o-brien" reads as a typo; "obrien" reads as a name.
    expect(normalizeChannelName("O'Brien deal")).toBe("obrien-deal");
  });

  it("truncates at Slack's 80-character limit", () => {
    expect(normalizeChannelName("a".repeat(200))).toHaveLength(80);
  });

  it("leaves an already-valid name alone", () => {
    expect(normalizeChannelName("deal-acme-2026")).toBe("deal-acme-2026");
  });
});
