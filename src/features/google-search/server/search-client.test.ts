import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customSearch, placesTextSearch } from "./search-client";

const searchSecret = { apiKey: "AIza-test", cx: "engine-123" };
const mapsSecret = { apiKey: "AIza-maps-test" };

function stubGoogle(response: {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}) {
  const calls: Array<{ url: URL; headers: Headers; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
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

describe("customSearch — quota vs rate limit (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does NOT retry an exhausted daily quota", async () => {
    // The distinction that matters. Google answers 429 for both a per-second
    // burst and a daily quota that will not reset for hours; retrying the
    // second spends the whole attempt budget and reports the wrong cause.
    stubGoogle({
      body: {
        error: {
          message: "Quota exceeded",
          errors: [{ reason: "dailyLimitExceeded" }],
        },
      },
      status: 429,
    });

    const error = (await customSearch({
      secret: searchSecret,
      query: "x",
      start: 1,
      num: 10,
      where: "Google Search node",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/does not reset|100 queries a day/i);
  });

  it("retries a per-second rate limit", async () => {
    stubGoogle({
      body: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
      status: 429,
    });

    await expect(
      customSearch({
        secret: searchSecret,
        query: "x",
        start: 1,
        num: 10,
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("names the API enablement on a 403", async () => {
    stubGoogle({ body: { error: { message: "forbidden" } }, status: 403 });
    const error = (await customSearch({
      secret: searchSecret,
      query: "x",
      start: 1,
      num: 10,
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/enabled|restrictions/i);
  });

  it("retries a 5xx", async () => {
    stubGoogle({ body: {}, status: 503 });
    await expect(
      customSearch({
        secret: searchSecret,
        query: "x",
        start: 1,
        num: 10,
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });
});

describe("customSearch — the credential (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes cx from the credential, never from config", async () => {
    // cx identifies the engine the key is billed against. Letting a workflow
    // set it would let one workflow point a colleague's key elsewhere.
    const { calls } = stubGoogle({ body: { items: [] } });

    await customSearch({
      secret: searchSecret,
      query: "widgets",
      start: 1,
      num: 10,
      where: "test",
    });

    expect(calls[0].url.searchParams.get("cx")).toBe("engine-123");
    expect(calls[0].url.searchParams.get("q")).toBe("widgets");
  });

  it("says what is missing when the credential has no cx", async () => {
    await expect(
      customSearch({
        secret: { apiKey: "k" },
        query: "x",
        start: 1,
        num: 10,
        where: "Test node",
      }),
    ).rejects.toThrow(/search-engine id/i);
  });

  it("caps num at Google's ten-per-request limit", async () => {
    const { calls } = stubGoogle({ body: { items: [] } });
    await customSearch({
      secret: searchSecret,
      query: "x",
      start: 1,
      num: 50,
      where: "test",
    });
    expect(calls[0].url.searchParams.get("num")).toBe("10");
  });

  it("maps results and reads Google's estimated total", async () => {
    stubGoogle({
      body: {
        items: [
          {
            title: "A",
            link: "https://a.example",
            snippet: "s",
            displayLink: "a.example",
          },
        ],
        searchInformation: { totalResults: "4310" },
      },
    });

    const result = await customSearch({
      secret: searchSecret,
      query: "x",
      start: 1,
      num: 10,
      where: "test",
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].link).toBe("https://a.example");
    expect(result.totalResults).toBe(4310);
  });
});

describe("placesTextSearch — the field mask is the price list (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("omits the billed-higher contact fields unless asked", async () => {
    // Places (New) bills by SKU according to the mask. `*` — the obvious
    // shortcut — would put every call on the most expensive tier.
    const { calls } = stubGoogle({ body: { places: [] } });

    await placesTextSearch({
      secret: mapsSecret,
      query: "dentists",
      pageSize: 20,
      includeContactDetails: false,
      where: "test",
    });

    const mask = calls[0].headers.get("x-goog-fieldmask") ?? "";
    expect(mask).toContain("places.displayName");
    expect(mask).not.toContain("nationalPhoneNumber");
    expect(mask).not.toContain("websiteUri");
    expect(mask).not.toContain("*");
  });

  it("adds them when the node asked for contact details", async () => {
    const { calls } = stubGoogle({ body: { places: [] } });

    await placesTextSearch({
      secret: mapsSecret,
      query: "dentists",
      pageSize: 20,
      includeContactDetails: true,
      where: "test",
    });

    const mask = calls[0].headers.get("x-goog-fieldmask") ?? "";
    expect(mask).toContain("nationalPhoneNumber");
    expect(mask).toContain("websiteUri");
  });

  it("always sends the mask, without which the request is a 400", async () => {
    const { calls } = stubGoogle({ body: { places: [] } });
    await placesTextSearch({
      secret: mapsSecret,
      query: "x",
      pageSize: 5,
      includeContactDetails: false,
      where: "test",
    });
    expect(calls[0].headers.get("x-goog-fieldmask")).toBeTruthy();
  });

  it("folds the region into the text query", async () => {
    // Places' locationBias takes coordinates; what a workflow has is a place
    // name, and text search reads "dentists in Leeds" the way a person would.
    const { calls } = stubGoogle({ body: { places: [] } });

    await placesTextSearch({
      secret: mapsSecret,
      query: "dentists",
      pageSize: 20,
      region: "Leeds",
      includeContactDetails: false,
      where: "test",
    });

    expect(calls[0].body).toMatchObject({ textQuery: "dentists in Leeds" });
  });

  it("maps a place, reading the nested display name", async () => {
    stubGoogle({
      body: {
        places: [
          {
            displayName: { text: "Bright Smiles" },
            formattedAddress: "1 High St",
            rating: 4.6,
            userRatingCount: 82,
            types: ["dentist"],
          },
        ],
      },
    });

    const result = await placesTextSearch({
      secret: mapsSecret,
      query: "dentists",
      pageSize: 20,
      includeContactDetails: false,
      where: "test",
    });

    expect(result.places[0]).toMatchObject({
      name: "Bright Smiles",
      address: "1 High St",
      rating: 4.6,
      userRatingCount: 82,
    });
    // Not requested, so null rather than absent.
    expect(result.places[0].phone).toBeNull();
  });

  it("says a Custom Search key is not automatically a Places key on a 403", async () => {
    stubGoogle({ body: { error: { message: "denied" } }, status: 403 });
    const error = (await placesTextSearch({
      secret: mapsSecret,
      query: "x",
      pageSize: 5,
      includeContactDetails: false,
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/Places API/i);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      placesTextSearch({
        secret: undefined,
        query: "x",
        pageSize: 5,
        includeContactDetails: false,
        where: "Test node",
      }),
    ).rejects.toThrow(/no Google Maps credential/i);
  });
});
