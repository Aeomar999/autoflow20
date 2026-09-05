import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ApifyRun,
  abortApifyRun,
  apifyFetch,
  describeRunOutcome,
  fetchApifyDataset,
  getApifyRun,
  isTerminal,
  startApifyRun,
} from "./apify-client";

const secret = { apiKey: "apify_api_test" };

function stubApify(
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
    return new Response(
      next.body === undefined ? "" : JSON.stringify(next.body),
      {
        status: next.status ?? 200,
        headers: {
          "content-type": "application/json",
          ...(next.headers ?? {}),
        },
      },
    );
  }) as typeof fetch);
  return { calls };
}

describe("isTerminal (AF-M10-19)", () => {
  it("treats every ended state as terminal, not just success", () => {
    // Polling only for SUCCEEDED would wait out the full timeout on a run
    // that failed in the first ten seconds — and keep billing while it did.
    for (const status of ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]) {
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it("treats in-flight states as not terminal", () => {
    for (const status of ["READY", "RUNNING", "ABORTING"]) {
      expect(isTerminal(status), status).toBe(false);
    }
  });
});

describe("describeRunOutcome (AF-M10-19)", () => {
  const run = (over: Partial<ApifyRun>): ApifyRun => ({
    id: "r1",
    status: "SUCCEEDED",
    ...over,
  });

  it("passes a succeeded run", () => {
    expect(describeRunOutcome(run({}), "test")).toBeUndefined();
  });

  it("fails a FAILED run, which the API reports as a 200", () => {
    // The trap: the HTTP call succeeded, the actor did not. Without this the
    // node reports success and hands an empty dataset to the next step.
    const error = describeRunOutcome(
      run({ status: "FAILED", exitCode: 1 }),
      "Apify Run node",
    );
    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error?.message).toContain("exit code 1");
  });

  it("explains a TIMED-OUT run in terms of the actor's own timeout", () => {
    const error = describeRunOutcome(
      run({ status: "TIMED-OUT", stats: { runTimeSecs: 300 } }),
      "test",
    );
    expect(error?.message).toMatch(/300s/);
  });

  it("reports an aborted run rather than treating it as success", () => {
    expect(
      describeRunOutcome(run({ status: "ABORTED" }), "test"),
    ).toBeInstanceOf(NonRetriableError);
  });

  it("still produces a message for a state it has never seen", () => {
    const error = describeRunOutcome(
      run({ status: "WEIRD-NEW-STATE" }),
      "test",
    );
    expect(error?.message).toContain("WEIRD-NEW-STATE");
  });
});

describe("startApifyRun (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts the username/actor form people paste from the console", () => {
    // Apify's API path wants `username~actor`; a slash 404s in a way that
    // reads like the actor does not exist.
    const { calls } = stubApify([
      { body: { data: { id: "run-1", status: "READY" } } },
    ]);

    return startApifyRun({
      secret,
      actorId: "apify/web-scraper",
      where: "test",
    }).then(() => {
      expect(decodeURIComponent(calls[0].url.pathname)).toContain(
        "apify~web-scraper",
      );
    });
  });

  it("sets Apify's own run timeout as a backstop under ours", async () => {
    // If this workflow dies between polls, the run must still stop on its own
    // rather than bill until somebody notices.
    const { calls } = stubApify([
      { body: { data: { id: "run-1", status: "READY" } } },
    ]);

    await startApifyRun({
      secret,
      actorId: "acme~scraper",
      timeoutSecs: 360,
      where: "test",
    });

    expect(calls[0].url.searchParams.get("timeout")).toBe("360");
  });

  it("refuses a response with no run id rather than returning a broken run", async () => {
    stubApify([{ body: { data: {} } }]);
    await expect(
      startApifyRun({ secret, actorId: "a~b", where: "test" }),
    ).rejects.toThrow(/no run id/i);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      startApifyRun({ secret: undefined, actorId: "a~b", where: "Test node" }),
    ).rejects.toThrow(/no Apify credential/i);
  });
});

describe("abortApifyRun (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports success when the run was stopped", async () => {
    stubApify([{ body: { data: { id: "r1", status: "ABORTED" } } }]);
    await expect(
      abortApifyRun({ secret, runId: "r1", where: "test" }),
    ).resolves.toBe(true);
  });

  it("returns false instead of throwing when the abort fails", async () => {
    // The caller is already reporting something worse — a timeout or a
    // cancellation. Throwing here would replace that message with this one and
    // hide the actual cause.
    stubApify([{ body: { error: { message: "nope" } }, status: 500 }]);
    await expect(
      abortApifyRun({ secret, runId: "r1", where: "test" }),
    ).resolves.toBe(false);
  });
});

describe("fetchApifyDataset (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stops at the cap and reports truncation", async () => {
    // A crawl of a large site produces tens of thousands of items. Silently
    // returning the first slice makes a partial run look complete.
    const page = Array.from({ length: 1000 }, (_, i) => ({ i }));
    stubApify([{ body: page }]);

    const result = await fetchApifyDataset<{ i: number }>({
      secret,
      datasetId: "d1",
      limit: 1000,
      where: "test",
    });

    expect(result.items).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });

  it("does not report truncation when the dataset simply ended", async () => {
    stubApify([{ body: [{ i: 1 }, { i: 2 }] }]);

    const result = await fetchApifyDataset({
      secret,
      datasetId: "d1",
      limit: 500,
      where: "test",
    });

    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("advances the offset across pages", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ i }));
    const { calls } = stubApify([{ body: full }, { body: [{ i: 1000 }] }]);

    const result = await fetchApifyDataset({
      secret,
      datasetId: "d1",
      limit: 2000,
      where: "test",
    });

    expect(result.items).toHaveLength(1001);
    expect(calls[1].url.searchParams.get("offset")).toBe("1000");
  });

  it("handles an empty dataset", async () => {
    stubApify([{ body: [] }]);
    const result = await fetchApifyDataset({
      secret,
      datasetId: "d1",
      limit: 100,
      where: "test",
    });
    expect(result.items).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("apifyFetch (AF-M10-19)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("unwraps the { data } envelope most endpoints use", async () => {
    stubApify([{ body: { data: { id: "r1", status: "RUNNING" } } }]);
    const run = await getApifyRun({ secret, runId: "r1", where: "test" });
    expect(run.status).toBe("RUNNING");
  });

  it("passes through a bare array, which the dataset endpoint returns", async () => {
    stubApify([{ body: [{ a: 1 }] }]);
    const items = await apifyFetch<Array<{ a: number }>>(secret, {
      path: "/datasets/d1/items",
      where: "test",
    });
    expect(items).toEqual([{ a: 1 }]);
  });

  it("names the actor-id format on a 404", async () => {
    stubApify([{ body: { error: { message: "not found" } }, status: 404 }]);
    const error = (await apifyFetch(secret, {
      path: "/acts/x/runs",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toContain("username~actor-name");
  });

  it("retries a 429 and a 5xx", async () => {
    stubApify([{ body: {}, status: 429, headers: { "retry-after": "30" } }]);
    await expect(
      apifyFetch(secret, { path: "/x", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);

    vi.restoreAllMocks();
    stubApify([{ body: {}, status: 503 }]);
    await expect(
      apifyFetch(secret, { path: "/x", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("does not retry a rejected token", async () => {
    stubApify([{ body: {}, status: 401 }]);
    await expect(
      apifyFetch(secret, { path: "/x", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});
