import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apolloFetch, shapeOrganization, shapePerson } from "./apollo-client";

const secret = { apiKey: "apollo_test_key" };

function stubApollo(response: {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}) {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers as HeadersInit),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(response.headers ?? {}),
      },
    });
  }) as typeof fetch);
  return { calls };
}

describe("apolloFetch — rate limits (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does NOT retry when the daily allowance is gone", async () => {
    // The distinction that matters. Apollo enforces per-minute and per-day
    // windows and answers 429 for both. Retrying an exhausted day every
    // thirty seconds spends the whole retry budget to learn nothing.
    stubApollo({
      body: {},
      status: 429,
      headers: { "x-24-hour-requests-left": "0" },
    });

    const error = (await apolloFetch(secret, {
      path: "/people/match",
      body: {},
      where: "Apollo Enrich node",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/daily/i);
  });

  it("retries when only the per-minute window is exhausted", async () => {
    stubApollo({
      body: {},
      status: 429,
      headers: { "x-24-hour-requests-left": "4200", "retry-after": "45" },
    });

    await expect(
      apolloFetch(secret, { path: "/people/match", body: {}, where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("retries a 429 with no window headers at all", async () => {
    // Absent headers must not be read as "the day is gone" — that would turn a
    // transient limit into a failed run.
    stubApollo({ body: {}, status: 429 });
    await expect(
      apolloFetch(secret, { path: "/people/match", body: {}, where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });
});

describe("apolloFetch — auth and validation (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the key as x-api-key, not in the body", async () => {
    // Older Apollo examples put api_key in the body. That still works on some
    // endpoints and silently 401s on others.
    const { calls } = stubApollo({ body: { person: null } });

    await apolloFetch(secret, {
      path: "/people/match",
      body: { email: "a@b.com" },
      where: "test",
    });

    expect(calls[0].headers.get("x-api-key")).toBe("apollo_test_key");
    expect(calls[0].body).not.toHaveProperty("api_key");
  });

  it("explains that a 401 may be a key without API access", async () => {
    stubApollo({ body: {}, status: 401 });
    const error = (await apolloFetch(secret, {
      path: "/people/match",
      body: {},
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/master key|API access/i);
  });

  it("explains what a usable person query needs on a 422", async () => {
    stubApollo({ body: {}, status: 422 });
    const error = (await apolloFetch(secret, {
      path: "/people/match",
      body: {},
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/email.*name.*domain|domain/i);
  });

  it("retries a 5xx", async () => {
    stubApollo({ body: {}, status: 502 });
    await expect(
      apolloFetch(secret, { path: "/people/match", body: {}, where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      apolloFetch(undefined, {
        path: "/people/match",
        body: {},
        where: "Test node",
      }),
    ).rejects.toThrow(/no Apollo credential/i);
  });

  it("returns a null person as a 200, which is how a miss arrives", async () => {
    // Apollo answers a no-match with {"person": null} rather than a 404, so
    // the client must NOT treat it as an error — the node decides.
    stubApollo({ body: { person: null } });
    const result = await apolloFetch<{ person: unknown }>(secret, {
      path: "/people/match",
      body: {},
      where: "test",
    });
    expect(result.person).toBeNull();
  });
});

describe("shapePerson (AF-M10-19)", () => {
  it("flattens the company onto the person, where a workflow reads it", () => {
    const shaped = shapePerson({
      id: "p1",
      first_name: "Ada",
      last_name: "Lovelace",
      title: "Analyst",
      organization: {
        name: "Analytical Engines",
        primary_domain: "engines.example",
        estimated_num_employees: 12,
      },
    });

    expect(shaped).toMatchObject({
      id: "p1",
      name: "Ada Lovelace",
      title: "Analyst",
      companyName: "Analytical Engines",
      companyDomain: "engines.example",
      companyEmployees: 12,
    });
  });

  it("reports a withheld email as null rather than omitting the field", () => {
    // Absent unless the request paid to reveal it. A missing key would make
    // downstream templates render "undefined".
    expect(shapePerson({ id: "p1" }).email).toBeNull();
  });

  it("builds a display name when Apollo sends only the parts", () => {
    expect(shapePerson({ first_name: "Ada", last_name: "Lovelace" }).name).toBe(
      "Ada Lovelace",
    );
  });
});

describe("shapeOrganization (AF-M10-19)", () => {
  it("flattens the fields a workflow uses", () => {
    expect(
      shapeOrganization({
        id: "o1",
        name: "Acme",
        primary_domain: "acme.example",
        estimated_num_employees: 300,
        annual_revenue: 1_000_000,
      }),
    ).toMatchObject({
      id: "o1",
      name: "Acme",
      domain: "acme.example",
      employees: 300,
      annualRevenue: 1_000_000,
    });
  });

  it("nulls every absent field rather than dropping it", () => {
    const shaped = shapeOrganization({ id: "o1" });
    expect(shaped.website).toBeNull();
    expect(shaped.industry).toBeNull();
  });
});
