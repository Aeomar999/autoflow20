import { createHmac } from "node:crypto";
import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubFetch, githubPaginate, parseRepo } from "./github-client";
import {
  githubEventMatches,
  parseGithubDelivery,
  verifyGithubSignature,
} from "./webhook";

const secret = { accessToken: "ghu_test" };

function stubGithub(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: URL[] = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
  ) => {
    calls.push(new URL(String(input)));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json", ...(next.headers ?? {}) },
    });
  }) as typeof fetch);
  return { calls };
}

describe("githubFetch — rate limits vs permissions (AF-M10-18)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("treats a primary rate limit 403 as retriable, not a permission error", async () => {
    // The trap: GitHub reports an exhausted rate limit as 403, so a bare
    // `status === 403 -> permanent` turns a wait-and-succeed into a failure.
    const reset = Math.floor(Date.now() / 1000) + 120;
    stubGithub([
      {
        body: { message: "API rate limit exceeded" },
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(reset),
        },
      },
    ]);

    const error = (await githubFetch(secret, {
      path: "/repos/a/b",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(RetryAfterError);
  });

  it("treats a secondary rate limit 403 as retriable", async () => {
    // The secondary limiter sends retry-after and NO remaining counter.
    stubGithub([
      {
        body: { message: "You have exceeded a secondary rate limit" },
        status: 403,
        headers: { "retry-after": "45" },
      },
    ]);

    await expect(
      githubFetch(secret, { path: "/repos/a/b", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("treats a genuine 403 as permanent", async () => {
    // No rate-limit headers at all: this one really is permissions.
    stubGithub([{ body: { message: "Resource not accessible" }, status: 403 }]);

    const error = (await githubFetch(secret, {
      path: "/repos/a/b",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/repo.*scope|organisation/i);
  });

  it("explains that a 404 may be a permission problem", async () => {
    // GitHub answers 404 rather than 403 for a private repo the token cannot
    // see. Reporting "not found" sends people hunting for a typo.
    stubGithub([{ body: { message: "Not Found" }, status: 404 }]);

    const error = (await githubFetch(secret, {
      path: "/repos/a/b",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/private/i);
  });

  it("does not retry a 401", async () => {
    stubGithub([{ body: { message: "Bad credentials" }, status: 401 }]);
    await expect(
      githubFetch(secret, { path: "/user", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });

  it("retries a 5xx", async () => {
    stubGithub([{ body: {}, status: 502 }]);
    await expect(
      githubFetch(secret, { path: "/user", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      githubFetch(undefined, { path: "/user", where: "Test node" }),
    ).rejects.toThrow(/no GitHub credential/i);
  });
});

describe("githubPaginate (AF-M10-18)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("follows the Link header and stops when rel=next is absent", async () => {
    const { calls } = stubGithub([
      {
        body: [{ sha: "a" }, { sha: "b" }],
        headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
      },
      { body: [{ sha: "c" }] },
    ]);

    const result = await githubPaginate<{ sha: string }>(secret, {
      path: "/repos/a/b/commits",
      limit: 100,
      where: "test",
    });

    expect(result.items.map((c) => c.sha)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(false);
    expect(calls[1].searchParams.get("page")).toBe("2");
  });

  it("reports truncation rather than implying it got everything", async () => {
    stubGithub([
      {
        body: [{ sha: "a" }, { sha: "b" }],
        headers: { link: '<https://api.github.com/x?page=2>; rel="next"' },
      },
    ]);

    const result = await githubPaginate(secret, {
      path: "/repos/a/b/commits",
      limit: 2,
      where: "test",
    });

    expect(result.truncated).toBe(true);
  });
});

describe("parseRepo (AF-M10-18)", () => {
  it("accepts owner/repo", () => {
    expect(parseRepo("acme/web", "test")).toEqual({
      owner: "acme",
      repo: "web",
    });
  });

  it("accepts a pasted URL, which is what people actually have", () => {
    expect(parseRepo("https://github.com/acme/web", "test")).toEqual({
      owner: "acme",
      repo: "web",
    });
  });

  it("strips a .git suffix", () => {
    expect(parseRepo("https://github.com/acme/web.git", "test")).toEqual({
      owner: "acme",
      repo: "web",
    });
  });

  it("rejects a bare name with a message naming the format", () => {
    // Without this the value becomes a 404 whose message blames permissions.
    expect(() => parseRepo("web", "Test node")).toThrow(/owner\/repo/);
  });
});

describe("GitHub webhook (AF-M10-18)", () => {
  const SECRET = "webhook-secret";
  const BODY = '{"action":"opened"}';
  const sign = (body: string, s = SECRET) =>
    `sha256=${createHmac("sha256", s).update(body, "utf8").digest("hex")}`;

  it("accepts a correct signature", () => {
    expect(
      verifyGithubSignature({
        rawBody: BODY,
        signature: sign(BODY),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it("rejects a signature from a different secret", () => {
    expect(
      verifyGithubSignature({
        rawBody: BODY,
        signature: sign(BODY, "other"),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects the legacy SHA-1 header", () => {
    // GitHub still sends X-Hub-Signature (SHA-1) for old consumers. Accepting
    // it would let anyone who can forge the weaker digest through.
    const sha1 = createHmac("sha1", SECRET).update(BODY, "utf8").digest("hex");
    expect(
      verifyGithubSignature({
        rawBody: BODY,
        signature: `sha1=${sha1}`,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("reads the event name from the header, not the body", () => {
    // A push body and a pull_request body share almost no top-level keys, so
    // sniffing the shape works until it doesn't.
    const headers = new Headers({
      "x-github-event": "pull_request",
      "x-github-delivery": "d-1",
    });
    const parsed = parseGithubDelivery({
      headers,
      body: {
        action: "opened",
        repository: { full_name: "acme/web" },
        sender: { login: "octocat" },
      },
    });

    expect(parsed).toEqual({
      event: "pull_request",
      action: "opened",
      repository: "acme/web",
      sender: "octocat",
      deliveryId: "d-1",
    });
  });

  it("does not drop push events when an action filter is set", () => {
    // `push` has no action. Applying an action filter to it would silently
    // drop every push for a trigger that also wanted opened PRs.
    const push = parseGithubDelivery({
      headers: new Headers({ "x-github-event": "push" }),
      body: { repository: { full_name: "acme/web" } },
    });

    expect(
      githubEventMatches(push, {
        events: ["push", "pull_request"],
        actions: ["opened"],
      }),
    ).toBe(true);
  });

  it("applies the action filter to events that have one", () => {
    const closed = parseGithubDelivery({
      headers: new Headers({ "x-github-event": "pull_request" }),
      body: { action: "closed" },
    });

    expect(
      githubEventMatches(closed, {
        events: ["pull_request"],
        actions: ["opened"],
      }),
    ).toBe(false);
  });

  it("treats an empty filter as any", () => {
    const anything = parseGithubDelivery({
      headers: new Headers({ "x-github-event": "release" }),
      body: {},
    });
    expect(githubEventMatches(anything, {})).toBe(true);
  });

  it("rejects an event the trigger did not subscribe to", () => {
    const issue = parseGithubDelivery({
      headers: new Headers({ "x-github-event": "issues" }),
      body: { action: "opened" },
    });
    expect(githubEventMatches(issue, { events: ["push"] })).toBe(false);
  });
});
