import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findOrCreateCustomer, stripeFetch, toFormBody } from "./stripe-client";

const secret = { apiKey: "sk_test_123" };

function stubStripe(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{
    url: URL;
    method: string;
    headers: Headers;
    body: string;
  }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as HeadersInit),
      body: String(init?.body ?? ""),
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

describe("toFormBody — Stripe takes form encoding, not JSON (AF-M10-20)", () => {
  it("nests objects in bracket form", () => {
    // Sending JSON gets a 400 whose message never mentions the encoding.
    const body = toFormBody({ metadata: { order_id: "A1" } });
    expect(body.get("metadata[order_id]")).toBe("A1");
  });

  it("indexes arrays", () => {
    const body = toFormBody({
      line_items: [{ price: "price_1", quantity: 2 }],
    });
    expect(body.get("line_items[0][price]")).toBe("price_1");
    expect(body.get("line_items[0][quantity]")).toBe("2");
  });

  it("omits null and undefined rather than sending the strings", () => {
    // `String(null)` is "null", which Stripe stores as the literal text.
    const body = toFormBody({ name: null, phone: undefined, email: "a@b.com" });
    expect(body.has("name")).toBe(false);
    expect(body.has("phone")).toBe(false);
    expect(body.get("email")).toBe("a@b.com");
  });

  it("handles nesting several levels deep", () => {
    const body = toFormBody({
      after_completion: { type: "redirect", redirect: { url: "https://x" } },
    });
    expect(body.get("after_completion[redirect][url]")).toBe("https://x");
  });
});

describe("stripeFetch — the idempotency header (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends Idempotency-Key on a POST", async () => {
    const { calls } = stubStripe([{ body: { id: "cus_1" } }]);

    await stripeFetch(secret, {
      path: "/customers",
      method: "POST",
      body: { email: "a@b.com" },
      idempotencyKey: "key-abc",
      where: "test",
    });

    expect(calls[0].headers.get("idempotency-key")).toBe("key-abc");
    expect(calls[0].headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("does not send it on a GET, where it means nothing", async () => {
    const { calls } = stubStripe([{ body: { data: [] } }]);
    await stripeFetch(secret, {
      path: "/customers",
      query: { email: "a@b.com" },
      where: "test",
    });
    expect(calls[0].headers.get("idempotency-key")).toBeNull();
  });

  it("form-encodes query parameters too", async () => {
    const { calls } = stubStripe([{ body: { data: [] } }]);
    await stripeFetch(secret, {
      path: "/customers",
      query: { email: "a@b.com", limit: 1 },
      where: "test",
    });
    expect(calls[0].url.searchParams.get("email")).toBe("a@b.com");
    expect(calls[0].url.searchParams.get("limit")).toBe("1");
  });
});

describe("stripeFetch — error classification (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not retry a declined card", async () => {
    // The issuer said no. Retrying will not change their mind, and every
    // attempt shows on the customer's statement.
    stubStripe([
      {
        body: {
          error: {
            type: "card_error",
            code: "card_declined",
            message: "Declined",
          },
        },
        status: 402,
      },
    ]);

    const error = (await stripeFetch(secret, {
      path: "/charges",
      method: "POST",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/issuer|declined/i);
  });

  it("retries a 5xx, which is safe because the key travels with it", async () => {
    stubStripe([{ body: {}, status: 503 }]);
    await expect(
      stripeFetch(secret, { path: "/customers", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("retries a rate limit", async () => {
    stubStripe([{ body: {}, status: 429, headers: { "retry-after": "8" } }]);
    await expect(
      stripeFetch(secret, { path: "/customers", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("does not retry a rejected key", async () => {
    stubStripe([
      { body: { error: { message: "Invalid API Key" } }, status: 401 },
    ]);
    await expect(
      stripeFetch(secret, { path: "/customers", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      stripeFetch(undefined, { path: "/customers", where: "Test node" }),
    ).rejects.toThrow(/no Stripe credential/i);
  });
});

describe("findOrCreateCustomer (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reuses an existing customer rather than making a second", async () => {
    // Stripe treats email as a label, not a key, and will happily hold four
    // customers with the same address. This is the node that prevents that.
    const { calls } = stubStripe([
      { body: { data: [{ id: "cus_existing", email: "a@b.com" }] } },
    ]);

    const result = await findOrCreateCustomer({
      secret,
      email: "a@b.com",
      idempotencyKey: "k",
      where: "test",
    });

    expect(result.created).toBe(false);
    expect(result.customer.id).toBe("cus_existing");
    // One call: the search. No create was attempted.
    expect(calls).toHaveLength(1);
  });

  it("creates when the search finds nobody, carrying the key", async () => {
    const { calls } = stubStripe([
      { body: { data: [] } },
      { body: { id: "cus_new", email: "a@b.com" } },
    ]);

    const result = await findOrCreateCustomer({
      secret,
      email: "a@b.com",
      name: "Ada",
      idempotencyKey: "key-xyz",
      where: "test",
    });

    expect(result.created).toBe(true);
    expect(result.customer.id).toBe("cus_new");
    expect(calls[1].method).toBe("POST");
    // The key is what makes a retry of this whole step safe even if the
    // search races.
    expect(calls[1].headers.get("idempotency-key")).toBe("key-xyz");
    expect(calls[1].body).toContain("name=Ada");
  });

  it("searches before it creates", async () => {
    const { calls } = stubStripe([
      { body: { data: [] } },
      { body: { id: "cus_new" } },
    ]);

    await findOrCreateCustomer({
      secret,
      email: "a@b.com",
      idempotencyKey: "k",
      where: "test",
    });

    expect(calls[0].method).toBe("GET");
    expect(calls[0].url.searchParams.get("email")).toBe("a@b.com");
  });
});
