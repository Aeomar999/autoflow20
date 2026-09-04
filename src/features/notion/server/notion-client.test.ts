import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNotionProperty,
  normalizeNotionId,
  notionFetch,
  readNotionProperty,
} from "./notion-client";

const secret = { accessToken: "ntn_test" };

function stubNotion(
  responses: Array<{
    body: unknown;
    status?: number;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Array<{ url: URL; headers: Headers }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
      headers: new Headers(init?.headers as HeadersInit),
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

describe("notionFetch (AF-M10-18)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("always sends Notion-Version, without which every call is a 400", async () => {
    const { calls } = stubNotion([{ body: { id: "x" } }]);
    await notionFetch(secret, { path: "/databases/x", where: "test" });
    expect(calls[0].headers.get("notion-version")).toBe("2022-06-28");
  });

  it("explains that object_not_found usually means not shared", async () => {
    // Notion returns the same code for "does not exist" and "not shared with
    // this integration", and the second is far more common. Reporting only
    // "not found" sends people looking for a wrong id.
    stubNotion([
      {
        body: { code: "object_not_found", message: "Could not find database" },
        status: 404,
      },
    ]);

    const error = (await notionFetch(secret, {
      path: "/databases/x",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/shared|connect this integration/i);
  });

  it("says property names are case-sensitive on a validation error", async () => {
    stubNotion([
      {
        body: { code: "validation_error", message: "body failed validation" },
        status: 400,
      },
    ]);
    const error = (await notionFetch(secret, {
      path: "/pages",
      method: "POST",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toMatch(/case-sensitive/i);
  });

  it("retries a rate limit", async () => {
    stubNotion([
      {
        body: { code: "rate_limited" },
        status: 429,
        headers: { "retry-after": "5" },
      },
    ]);
    await expect(
      notionFetch(secret, { path: "/databases/x", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("does not retry a revoked token", async () => {
    stubNotion([{ body: { code: "unauthorized" }, status: 401 }]);
    await expect(
      notionFetch(secret, { path: "/databases/x", where: "test" }),
    ).rejects.toBeInstanceOf(NonRetriableError);
  });
});

describe("normalizeNotionId (AF-M10-18)", () => {
  const DASHED = "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809";
  const BARE = DASHED.replace(/-/g, "");

  it("accepts the dashed form unchanged", () => {
    expect(normalizeNotionId(DASHED, "test")).toBe(DASHED);
  });

  it("adds dashes to the bare form", () => {
    expect(normalizeNotionId(BARE, "test")).toBe(DASHED);
  });

  it("extracts the id from a pasted page URL with a title slug", () => {
    // What people actually paste. Passing the whole URL through gives an
    // object_not_found that reads like a permission problem.
    expect(
      normalizeNotionId(`https://www.notion.so/acme/Roadmap-${BARE}`, "test"),
    ).toBe(DASHED);
  });

  it("takes the object id rather than a view id from a URL with ?v=", () => {
    const viewId = "ffffffffffffffffffffffffffffffff";
    expect(
      normalizeNotionId(
        `https://www.notion.so/acme/Tasks-${BARE}?v=${viewId}`,
        "test",
      ),
    ).toBe(DASHED);
  });

  it("rejects a value with no id in it", () => {
    expect(() => normalizeNotionId("my database", "Test node")).toThrow(
      /Notion id/,
    );
  });
});

describe("buildNotionProperty (AF-M10-18)", () => {
  it("wraps a title, which is the one column every database has", () => {
    expect(buildNotionProperty("title", "Ship it")).toEqual({
      title: [{ type: "text", text: { content: "Ship it" } }],
    });
  });

  it("wraps a select as an object, not rich text", () => {
    // The tagged-union trap: a select column rejects a rich_text value with an
    // error that does not name the column.
    expect(buildNotionProperty("select", "High")).toEqual({
      select: { name: "High" },
    });
  });

  it("splits a multi_select on commas", () => {
    expect(buildNotionProperty("multi_select", "bug, urgent")).toEqual({
      multi_select: [{ name: "bug" }, { name: "urgent" }],
    });
  });

  it("parses a number out of a formatted string", () => {
    expect(buildNotionProperty("number", "$1,240.50")).toEqual({
      number: 1240.5,
    });
  });

  it("skips a date Notion cannot parse rather than failing the page", () => {
    // An unparseable date is rejected for the WHOLE page, so one bad value
    // would lose every other column.
    expect(buildNotionProperty("date", "next tuesday")).toBeUndefined();
    expect(buildNotionProperty("date", "2026-09-04")).toEqual({
      date: { start: "2026-09-04" },
    });
  });

  it("reads a checkbox from the words people actually write", () => {
    for (const truthy of ["true", "Yes", "1", "checked"]) {
      expect(buildNotionProperty("checkbox", truthy)).toEqual({
        checkbox: true,
      });
    }
    expect(buildNotionProperty("checkbox", "no")).toEqual({ checkbox: false });
  });

  it("returns undefined for a computed column that cannot be written", () => {
    // Formula and rollup are computed by Notion; sending them is an error.
    expect(buildNotionProperty("formula", "anything")).toBeUndefined();
    expect(buildNotionProperty("rollup", "anything")).toBeUndefined();
  });

  it("returns undefined for an empty value", () => {
    expect(buildNotionProperty("rich_text", "   ")).toBeUndefined();
  });
});

describe("readNotionProperty (AF-M10-18)", () => {
  it("flattens rich text to a plain string", () => {
    expect(
      readNotionProperty({
        type: "rich_text",
        rich_text: [{ plain_text: "Hello " }, { plain_text: "world" }],
      }),
    ).toBe("Hello world");
  });

  it("flattens a select to its name", () => {
    expect(
      readNotionProperty({ type: "select", select: { name: "Done" } }),
    ).toBe("Done");
  });

  it("returns null for an empty select rather than throwing", () => {
    expect(readNotionProperty({ type: "select", select: null })).toBeNull();
  });

  it("flattens a multi_select to an array of names", () => {
    expect(
      readNotionProperty({
        type: "multi_select",
        multi_select: [{ name: "a" }, { name: "b" }],
      }),
    ).toEqual(["a", "b"]);
  });

  it("reads a formula's computed value", () => {
    expect(
      readNotionProperty({ type: "formula", formula: { number: 42 } }),
    ).toBe(42);
  });

  it("returns null for a shape it does not know", () => {
    expect(readNotionProperty({ type: "some_new_notion_type" })).toBeNull();
    expect(readNotionProperty(null)).toBeNull();
  });
});
