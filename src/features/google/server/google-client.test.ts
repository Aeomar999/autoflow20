import { NonRetriableError, RetryAfterError } from "inngest";
import { describe, expect, it } from "vitest";
import {
  classifyGoogleError,
  MAX_PAGE_BUDGET,
  paginate,
} from "./google-client";

describe("classifyGoogleError (AF-M10-15)", () => {
  /**
   * The acceptance calls this out specifically, and the direction is the whole
   * point: getting it backwards spends a user's remaining quota re-asking a
   * question that was permanently refused.
   */

  it("treats a 429 as retriable", () => {
    expect(
      classifyGoogleError({ status: 429, message: "Rate limit exceeded" }),
    ).toBeInstanceOf(RetryAfterError);
  });

  it("treats a quota 403 as retriable", () => {
    // Google overloads 403 across quota and permissions, so the reason has to
    // be read — the status alone cannot tell them apart.
    for (const reason of [
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "quotaExceeded",
      "dailyLimitExceeded",
    ]) {
      expect(
        classifyGoogleError({ status: 403, message: "quota", reason }),
        reason,
      ).toBeInstanceOf(RetryAfterError);
    }
  });

  it("treats a permissions 403 as PERMANENT", () => {
    // Retrying this three times with backoff burns quota to receive the same
    // refusal, and buries the real cause under retry noise.
    const error = classifyGoogleError({
      status: 403,
      message: "Request had insufficient authentication scopes.",
      reason: "insufficientPermissions",
    });
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/scope/i);
  });

  it("treats a 401 as permanent, and says reconnecting is the fix", () => {
    const error = classifyGoogleError({
      status: 401,
      message: "Invalid Credentials",
    });
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/reconnect/i);
  });

  it("treats a 404 as permanent", () => {
    // A spreadsheet that does not exist will not appear on a retry.
    expect(
      classifyGoogleError({
        status: 404,
        message: "Requested entity was not found.",
      }),
    ).toBeInstanceOf(NonRetriableError);
  });

  it("treats a 5xx as retriable", () => {
    expect(
      classifyGoogleError({ status: 503, message: "backend error" }),
    ).toBeInstanceOf(RetryAfterError);
  });

  it("treats an unclassified 4xx as permanent", () => {
    // Defaulting to retriable would make every malformed request cost four
    // round trips before failing.
    expect(
      classifyGoogleError({ status: 400, message: "Invalid range" }),
    ).toBeInstanceOf(NonRetriableError);
  });
});

describe("paginate (AF-M10-15)", () => {
  const pagesOf = (total: number, perPage = 2) => {
    const all = Array.from({ length: total }, (_, i) => `item-${i}`);
    return async (token?: string) => {
      const start = token ? Number.parseInt(token, 10) : 0;
      const items = all.slice(start, start + perPage);
      const next = start + perPage;
      return {
        items,
        nextPageToken: next < all.length ? String(next) : undefined,
      };
    };
  };

  const run = (
    fetchPage: (token?: string) => Promise<{
      items: string[];
      nextPageToken?: string;
    }>,
    limit: number,
    maxPages?: number,
  ) =>
    paginate({
      fetchPage,
      itemsOf: (page) => page.items,
      nextTokenOf: (page) => page.nextPageToken,
      limit,
      maxPages,
    });

  it("walks pages until the source runs out", async () => {
    const result = await run(pagesOf(5), 100);
    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(false);
    expect(result.pages).toBe(3);
  });

  it("stops at the item limit and says it was truncated", async () => {
    const result = await run(pagesOf(100), 5);
    expect(result.items).toHaveLength(5);
    // Reported, not silent: a caller that processed 5 of 100 rows and thought
    // it had them all is the failure this prevents.
    expect(result.truncated).toBe(true);
  });

  it("stops at the page budget rather than looping forever", async () => {
    // `while (nextPageToken)` on a folder with 200,000 files is one node
    // making an unbounded sequence of requests.
    let calls = 0;
    const endless = async () => {
      calls += 1;
      return { items: ["x"], nextPageToken: "more" };
    };

    const result = await run(endless, 1_000_000, 4);
    expect(calls).toBe(4);
    expect(result.pages).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it("never exceeds the platform's own page ceiling", async () => {
    let calls = 0;
    const endless = async () => {
      calls += 1;
      return { items: ["x"], nextPageToken: "more" };
    };
    await run(endless, 1_000_000, 10_000);
    expect(calls).toBe(MAX_PAGE_BUDGET);
  });

  it("makes exactly one call when the first page is the last", async () => {
    let calls = 0;
    const single = async () => {
      calls += 1;
      return { items: ["a", "b"] };
    };
    const result = await run(single, 10);
    expect(calls).toBe(1);
    expect(result.items).toEqual(["a", "b"]);
  });
});
