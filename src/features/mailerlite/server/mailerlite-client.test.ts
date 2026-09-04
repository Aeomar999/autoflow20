import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findSubscriber,
  mailerliteFetch,
  upsertSubscriber,
} from "./mailerlite-client";

const secret = { apiKey: "ml_test_key" };

function stubMailerLite(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
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

describe("findSubscriber (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null for a 404 rather than failing the run", async () => {
    // A list-hygiene workflow asks about people who are usually absent. A
    // miss is an answer, not an error.
    stubMailerLite([{ body: { message: "Not found" }, status: 404 }]);

    await expect(
      findSubscriber({ secret, email: "nobody@example.com", where: "test" }),
    ).resolves.toBeNull();
  });

  it("normalises the email before looking it up", async () => {
    const { calls } = stubMailerLite([{ body: { data: { id: "1" } } }]);
    await findSubscriber({
      secret,
      email: "  Ada@Example.COM ",
      where: "test",
    });
    expect(calls[0].url).toContain(encodeURIComponent("ada@example.com"));
  });

  it("returns the subscriber's status, which is not just present/absent", async () => {
    // Someone who unsubscribed still EXISTS. A workflow that only checked
    // existence would try to email them.
    stubMailerLite([
      {
        body: { data: { id: "s1", email: "a@b.com", status: "unsubscribed" } },
      },
    ]);

    const subscriber = await findSubscriber({
      secret,
      email: "a@b.com",
      where: "test",
    });

    expect(subscriber?.status).toBe("unsubscribed");
  });

  it("still throws on a real failure", async () => {
    stubMailerLite([{ body: {}, status: 401 }]);
    await expect(
      findSubscriber({ secret, email: "a@b.com", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});

describe("upsertSubscriber (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("assigns groups in the same request as the create", async () => {
    // Two requests would leave a window where the subscriber exists in no
    // group — long enough for an automation watching that group to miss them.
    const { calls } = stubMailerLite([
      { body: { data: { id: "s1", status: "active" } } },
    ]);

    await upsertSubscriber({
      secret,
      email: "a@b.com",
      groupIds: ["g1", "g2"],
      where: "test",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      email: "a@b.com",
      groups: ["g1", "g2"],
    });
  });

  it("omits empty fields and groups rather than sending empty containers", async () => {
    const { calls } = stubMailerLite([{ body: { data: { id: "s1" } } }]);
    await upsertSubscriber({
      secret,
      email: "a@b.com",
      fields: {},
      groupIds: [],
      where: "test",
    });
    expect(calls[0].body).toEqual({ email: "a@b.com" });
  });

  it("refuses a response with no subscriber", async () => {
    stubMailerLite([{ body: {} }]);
    await expect(
      upsertSubscriber({ secret, email: "a@b.com", where: "test" }),
    ).rejects.toThrow(/returned no subscriber/i);
  });

  it("passes through a status that is not active", async () => {
    // MailerLite answers 200 for someone who previously opted out WITHOUT
    // resubscribing them, so "the call worked" is not "they are on the list".
    stubMailerLite([{ body: { data: { id: "s1", status: "unsubscribed" } } }]);

    const subscriber = await upsertSubscriber({
      secret,
      email: "a@b.com",
      where: "test",
    });

    expect(subscriber.status).toBe("unsubscribed");
  });
});

describe("mailerliteFetch — errors (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("flattens the per-field 422 into a sentence", async () => {
    stubMailerLite([
      { body: { errors: { email: ["is invalid"] } }, status: 422 },
    ]);
    const error = (await mailerliteFetch(secret, {
      path: "/subscribers",
      method: "POST",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error.message).toContain("email: is invalid");
  });

  it("retries a rate limit", async () => {
    stubMailerLite([
      { body: {}, status: 429, headers: { "retry-after": "30" } },
    ]);
    await expect(
      mailerliteFetch(secret, { path: "/subscribers", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("does not swallow a 404 unless the caller allowed it", async () => {
    // allowNotFound is opt-in: a create that 404s is a real problem.
    stubMailerLite([{ body: {}, status: 404 }]);
    await expect(
      mailerliteFetch(secret, { path: "/subscribers", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      mailerliteFetch(undefined, { path: "/subscribers", where: "Test node" }),
    ).rejects.toThrow(/no MailerLite credential/i);
  });
});
