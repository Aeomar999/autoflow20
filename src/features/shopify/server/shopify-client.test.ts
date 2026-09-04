import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShopifyOrder,
  SHOPIFY_API_VERSION,
  SHOPIFY_SOURCE_NAME,
  shopifyFetch,
} from "./shopify-client";

const secret = {
  accessToken: "shpat_test",
  shopDomain: "acme-test.myshopify.com",
};

function stubShopify(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: URL; method: string; body: unknown }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
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

describe("createShopifyOrder — duplicate protection (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the existing order instead of billing the customer twice", async () => {
    // The requirement in one test. Orders have no idempotency header, so the
    // guard is source_name + source_identifier, which Shopify treats as unique
    // per shop. A retry after a lost response must not create a second order.
    const { calls } = stubShopify([
      { body: { orders: [{ id: 111, name: "#1001" }] } },
    ]);

    const result = await createShopifyOrder({
      secret,
      sourceIdentifier: "step-key-1",
      order: { line_items: [{ title: "Widget", quantity: 1 }] },
      where: "test",
    });

    expect(result.created).toBe(false);
    expect(result.order.id).toBe(111);
    // Only the lookup ran; nothing was written.
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });

  it("stamps the source pair on a new order", async () => {
    const { calls } = stubShopify([
      { body: { orders: [] } },
      { body: { order: { id: 222, name: "#1002" } } },
    ]);

    const result = await createShopifyOrder({
      secret,
      sourceIdentifier: "step-key-2",
      order: { line_items: [{ title: "Widget", quantity: 1 }] },
      where: "test",
    });

    expect(result.created).toBe(true);
    const posted = calls[1].body as { order: Record<string, unknown> };
    expect(posted.order.source_identifier).toBe("step-key-2");
    expect(posted.order.source_name).toBe(SHOPIFY_SOURCE_NAME);
  });

  it("looks up by the source identifier, including archived orders", async () => {
    // `status: any` matters: an order closed between the write and the retry
    // would otherwise be invisible and get duplicated.
    const { calls } = stubShopify([
      { body: { orders: [] } },
      { body: { order: { id: 1 } } },
    ]);

    await createShopifyOrder({
      secret,
      sourceIdentifier: "k",
      order: {},
      where: "test",
    });

    expect(calls[0].url.searchParams.get("source_identifier")).toBe("k");
    expect(calls[0].url.searchParams.get("status")).toBe("any");
  });

  it("refuses a create that returned no order", async () => {
    stubShopify([{ body: { orders: [] } }, { body: {} }]);
    await expect(
      createShopifyOrder({
        secret,
        sourceIdentifier: "k",
        order: {},
        where: "test",
      }),
    ).rejects.toThrow(/returned no order/i);
  });
});

describe("shopifyFetch (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pins the API version, so a response shape cannot change under a run", async () => {
    const { calls } = stubShopify([{ body: { orders: [] } }]);
    await shopifyFetch(secret, { path: "/orders.json", where: "test" });
    expect(calls[0].url.pathname).toContain(
      `/admin/api/${SHOPIFY_API_VERSION}/`,
    );
  });

  it("takes the shop domain from the credential, not from config", async () => {
    const { calls } = stubShopify([{ body: {} }]);
    await shopifyFetch(secret, { path: "/orders.json", where: "test" });
    expect(calls[0].url.host).toBe("acme-test.myshopify.com");
  });

  it("tolerates a shop domain pasted with a scheme", async () => {
    const { calls } = stubShopify([{ body: {} }]);
    await shopifyFetch(
      { accessToken: "t", shopDomain: "https://acme-test.myshopify.com/" },
      { path: "/orders.json", where: "test" },
    );
    expect(calls[0].url.host).toBe("acme-test.myshopify.com");
  });

  it("says what is missing when the credential has no shop domain", async () => {
    await expect(
      shopifyFetch({ accessToken: "t" }, { path: "/x", where: "Test node" }),
    ).rejects.toThrow(/shop domain/i);
  });

  it("flattens Shopify's per-field 422 into a readable sentence", async () => {
    stubShopify([
      { body: { errors: { line_items: ["is invalid"] } }, status: 422 },
    ]);
    const error = (await shopifyFetch(secret, {
      path: "/orders.json",
      method: "POST",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toContain("line_items: is invalid");
  });

  it("retries the leaky bucket", async () => {
    stubShopify([{ body: {}, status: 429, headers: { "retry-after": "2.0" } }]);
    await expect(
      shopifyFetch(secret, { path: "/orders.json", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("names the myshopify host on a 404", async () => {
    stubShopify([{ body: {}, status: 404 }]);
    const error = (await shopifyFetch(secret, {
      path: "/orders.json",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/myshopify/i);
  });
});
