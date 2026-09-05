import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeDriveQuery, moveDriveFile } from "./drive";

const secret = { accessToken: "ya29.token" };

/** Captures the requests and answers with what the test wants. */
function stubDrive(responses: Array<Record<string, unknown>>): {
  calls: Array<{ url: URL; method: string }>;
} {
  const calls: Array<{ url: URL; method: string }> = [];
  let index = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
    });
    const body = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return { calls };
}

describe("escapeDriveQuery (AF-M10-15)", () => {
  it("escapes an apostrophe so a folder name cannot end the query", () => {
    // A value goes into a quoted string in Drive's query language. Unescaped,
    // an apostrophe closes the string and the rest is parsed as syntax — the
    // same class of bug as SQL injection, in a query language people forget
    // is one.
    expect(escapeDriveQuery("O'Brien Contracts")).toBe("O\\'Brien Contracts");
  });

  it("escapes a backslash before the quote it could otherwise escape", () => {
    expect(escapeDriveQuery("a\\'b")).toBe("a\\\\\\'b");
  });

  it("leaves an ordinary id alone", () => {
    expect(escapeDriveQuery("1AbC_dEf-123")).toBe("1AbC_dEf-123");
  });
});

describe("moveDriveFile (AF-M10-15)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("swaps the parents, naming the old ones explicitly", async () => {
    // Drive has no "move": it is a parent swap, and the old parent must be
    // named or the file ends up in both folders.
    const { calls } = stubDrive([
      { id: "f1", name: "contract.pdf", parents: ["inbox"] },
      { id: "f1", name: "contract.pdf", parents: ["processed"] },
    ]);

    const moved = await moveDriveFile({
      secret,
      fileId: "f1",
      toFolderId: "processed",
      where: "test",
    });

    expect(moved.parents).toEqual(["processed"]);
    const patch = calls[1];
    expect(patch.method).toBe("PATCH");
    expect(patch.url.searchParams.get("addParents")).toBe("processed");
    expect(patch.url.searchParams.get("removeParents")).toBe("inbox");
  });

  it("is idempotent when the file is already in the destination", async () => {
    // A retried step lands here. Removing a parent the file no longer has
    // fails, which would turn a successful move into a failed run.
    const { calls } = stubDrive([
      { id: "f1", name: "contract.pdf", parents: ["processed"] },
    ]);

    const moved = await moveDriveFile({
      secret,
      fileId: "f1",
      toFolderId: "processed",
      where: "test",
    });

    expect(moved.parents).toEqual(["processed"]);
    // One call: the read. No PATCH was attempted.
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("removes every existing parent, not just the first", async () => {
    // A file can genuinely be in two folders; leaving one behind means the
    // watched folder still contains it and the next poll reprocesses it.
    const { calls } = stubDrive([
      { id: "f1", name: "c.pdf", parents: ["inbox", "shared"] },
      { id: "f1", name: "c.pdf", parents: ["processed"] },
    ]);

    await moveDriveFile({
      secret,
      fileId: "f1",
      toFolderId: "processed",
      where: "test",
    });

    expect(calls[1].url.searchParams.get("removeParents")).toBe("inbox,shared");
  });
});
