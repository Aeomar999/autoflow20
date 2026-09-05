import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { X_MAX_POST_CHARS, YOUTUBE_MAX_TITLE_CHARS } from "../constants";
import { requireAuthor } from "./linkedin-client";
import { postToX, weightedLength } from "./x-client";
import { startYouTubeUpload } from "./youtube-client";

function stub(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers as HeadersInit),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(next.body === null ? null : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: {
        "content-type": "application/json",
        ...(next.headers ?? {}),
      },
    });
  }) as typeof fetch);
  return { calls };
}

describe("weightedLength — X counts differently than JS (AF-M10-22)", () => {
  it("counts plain ASCII one for one", () => {
    expect(weightedLength("hello world")).toBe(11);
  });

  it("counts an emoji as two, as X does", () => {
    // Using String.length would let a post through that X then rejects, and
    // the rejection does not say by how much.
    expect(weightedLength("🎉")).toBe(2);
  });

  it("counts CJK as two", () => {
    expect(weightedLength("日本語")).toBe(6);
  });

  it("makes a 280-ASCII post exactly the limit", () => {
    expect(weightedLength("a".repeat(280))).toBe(X_MAX_POST_CHARS);
  });

  it("makes 200 emoji over the limit even though .length says 400", () => {
    const post = "🎉".repeat(200);
    // Two UTF-16 code units each, so .length is 400 — but the weighted count
    // is what X applies.
    expect(weightedLength(post)).toBe(400);
    expect(weightedLength(post)).toBeGreaterThan(X_MAX_POST_CHARS);
  });
});

describe("postToX (AF-M10-22)", () => {
  const secret = { accessToken: "x-token" };
  afterEach(() => vi.restoreAllMocks());

  it("names the API TIER on a 403, not the scopes", async () => {
    // The failure a user cannot fix from inside the product. A free-tier app
    // holds every scope and still gets 403 on every post.
    stub([{ body: { detail: "Unsupported Authentication" }, status: 403 }]);

    const error = (await postToX({
      secret,
      text: "hello",
      where: "X Post node",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/free API tier/i);
  });

  it("retries a rate limit with a long wait", async () => {
    // Post limits on the lower tiers are per 24 hours, so a 30-second retry
    // is pointless.
    stub([{ body: {}, status: 429 }]);
    await expect(
      postToX({ secret, text: "hi", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("sends a reply reference when building a thread", async () => {
    const { calls } = stub([{ body: { data: { id: "1", text: "hi" } } }]);
    await postToX({
      secret,
      text: "hi",
      replyToId: "999",
      where: "test",
    });
    expect(calls[0].body).toMatchObject({
      reply: { in_reply_to_tweet_id: "999" },
    });
  });

  it("refuses a response with no post id", async () => {
    stub([{ body: { data: {} } }]);
    await expect(
      postToX({ secret, text: "hi", where: "test" }),
    ).rejects.toThrow(/no post id/i);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      postToX({ secret: undefined, text: "hi", where: "Test node" }),
    ).rejects.toThrow(/no X credential/i);
  });
});

describe("requireAuthor — LinkedIn (AF-M10-22)", () => {
  it("builds a person URN from a bare member id", () => {
    expect(
      requireAuthor({ accessToken: "t", memberId: "abc123" }, "test").authorUrn,
    ).toBe("urn:li:person:abc123");
  });

  it("leaves an already-formed URN alone", () => {
    expect(
      requireAuthor(
        { accessToken: "t", memberId: "urn:li:person:abc123" },
        "test",
      ).authorUrn,
    ).toBe("urn:li:person:abc123");
  });

  it("says to reconnect when the credential has no member id", () => {
    // LinkedIn's own error for a missing author is a 422 about the request
    // body, which says nothing about the credential.
    expect(() => requireAuthor({ accessToken: "t" }, "Test node")).toThrow(
      /member id/i,
    );
  });

  it("refuses a node with no credential bound", () => {
    expect(() => requireAuthor(undefined, "Test node")).toThrow(
      /no LinkedIn credential/i,
    );
  });
});

describe("startYouTubeUpload (AF-M10-22)", () => {
  const secret = { accessToken: "g-token" };
  afterEach(() => vi.restoreAllMocks());

  it("announces the length and type up front, as the protocol requires", async () => {
    const { calls } = stub([
      {
        body: {},
        headers: { location: "https://upload.example/session-1" },
      },
    ]);

    const url = await startYouTubeUpload({
      secret,
      title: "A video",
      description: "",
      tags: [],
      privacyStatus: "private",
      contentLength: 12345,
      mimeType: "video/mp4",
      where: "test",
    });

    expect(url).toBe("https://upload.example/session-1");
    expect(calls[0].headers.get("x-upload-content-length")).toBe("12345");
    expect(calls[0].headers.get("x-upload-content-type")).toBe("video/mp4");
  });

  it("declares made-for-kids, which YouTube requires of API clients", async () => {
    // Omitting it is a 400 that names no field.
    const { calls } = stub([
      { body: {}, headers: { location: "https://upload.example/s" } },
    ]);

    await startYouTubeUpload({
      secret,
      title: "t",
      description: "",
      tags: [],
      privacyStatus: "unlisted",
      contentLength: 1,
      mimeType: "video/mp4",
      where: "test",
    });

    expect(calls[0].body).toMatchObject({
      status: { selfDeclaredMadeForKids: false },
    });
  });

  it("explains an exhausted quota in terms of project verification", async () => {
    // An unverified project gets a handful of uploads a day, and retrying does
    // not change that.
    stub([
      {
        body: { error: { errors: [{ reason: "quotaExceeded" }] } },
        status: 403,
      },
    ]);

    const error = (await startYouTubeUpload({
      secret,
      title: "t",
      description: "",
      tags: [],
      privacyStatus: "private",
      contentLength: 1,
      mimeType: "video/mp4",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/unverified|audit/i);
  });

  it("refuses a response with no session URL", async () => {
    stub([{ body: {} }]);
    await expect(
      startYouTubeUpload({
        secret,
        title: "t",
        description: "",
        tags: [],
        privacyStatus: "private",
        contentLength: 1,
        mimeType: "video/mp4",
        where: "test",
      }),
    ).rejects.toThrow(/no upload session/i);
  });

  it("retries a 5xx, which resumes rather than restarting", async () => {
    stub([{ body: {}, status: 503 }]);
    await expect(
      startYouTubeUpload({
        secret,
        title: "t",
        description: "",
        tags: [],
        privacyStatus: "private",
        contentLength: 1,
        mimeType: "video/mp4",
        where: "test",
      }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });
});

describe("platform limits are named, not guessed (AF-M10-22)", () => {
  it("exposes the numbers the nodes check against", () => {
    // The acceptance asks for the platform limit to appear in the error, which
    // means it has to be a value rather than something inferred from a
    // provider rejection.
    expect(X_MAX_POST_CHARS).toBe(280);
    expect(YOUTUBE_MAX_TITLE_CHARS).toBe(100);
  });
});
