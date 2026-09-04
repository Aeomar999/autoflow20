import { NonRetriableError, RetryAfterError } from "inngest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  airtableFetch,
  listAirtableRecords,
  updateAirtableRecord,
} from "./airtable-client";

const secret = { apiKey: "patTest123" };

function stubAirtable(responses: Array<{ body: unknown; status?: number }>) {
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
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch);
  return { calls };
}

describe("updateAirtableRecord (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never enables typecast", async () => {
    // With typecast on, Airtable CREATES new select options to force a write
    // through: a workflow writing "Hight" into a status column silently adds
    // "Hight" as a valid status, and nobody notices until they open the view.
    const { calls } = stubAirtable([
      { body: { id: "rec1", fields: { Status: "Done" } } },
    ]);

    await updateAirtableRecord({
      secret,
      baseId: "appX",
      table: "Tasks",
      recordId: "rec1",
      fields: { Status: "Done" },
      where: "test",
    });

    expect((calls[0].body as { typecast: boolean }).typecast).toBe(false);
  });

  it("uses PATCH, so untouched fields survive", async () => {
    // PUT clears every field the request does not mention, turning "set the
    // status" into "delete everything else on the row".
    const { calls } = stubAirtable([{ body: { id: "rec1", fields: {} } }]);

    await updateAirtableRecord({
      secret,
      baseId: "appX",
      table: "Tasks",
      recordId: "rec1",
      fields: { Status: "Done" },
      where: "test",
    });

    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url.pathname).toContain("rec1");
  });
});

describe("listAirtableRecords (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends filterByFormula so the filtering happens server-side", async () => {
    // Without it the node pages the whole table to find three rows, and
    // Airtable meters requests per base.
    const { calls } = stubAirtable([{ body: { records: [] } }]);

    await listAirtableRecords({
      secret,
      baseId: "appX",
      table: "Tasks",
      filterByFormula: '{Status} = "Active"',
      limit: 50,
      where: "test",
    });

    expect(calls[0].url.searchParams.get("filterByFormula")).toBe(
      '{Status} = "Active"',
    );
  });

  it("sends sort in Airtable's indexed form, not comma-separated", async () => {
    const { calls } = stubAirtable([{ body: { records: [] } }]);

    await listAirtableRecords({
      secret,
      baseId: "appX",
      table: "Tasks",
      sortField: "Modified",
      sortDirection: "desc",
      limit: 50,
      where: "test",
    });

    expect(calls[0].url.searchParams.get("sort[0][field]")).toBe("Modified");
    expect(calls[0].url.searchParams.get("sort[0][direction]")).toBe("desc");
  });

  it("follows the offset cursor across pages", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `rec${i}`,
      fields: {},
    }));
    const { calls } = stubAirtable([
      { body: { records: page, offset: "off1" } },
      { body: { records: [{ id: "rec100", fields: {} }] } },
    ]);

    const result = await listAirtableRecords({
      secret,
      baseId: "appX",
      table: "Tasks",
      limit: 200,
      where: "test",
    });

    expect(result.records).toHaveLength(101);
    expect(calls[1].url.searchParams.get("offset")).toBe("off1");
  });

  it("reports truncation when the cap stopped it, not the data", async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `rec${i}`,
      fields: {},
    }));
    stubAirtable([{ body: { records: page, offset: "more" } }]);

    const result = await listAirtableRecords({
      secret,
      baseId: "appX",
      table: "Tasks",
      limit: 100,
      where: "test",
    });

    expect(result.truncated).toBe(true);
  });

  it("does not report truncation when the table simply ended", async () => {
    stubAirtable([{ body: { records: [{ id: "rec1", fields: {} }] } }]);
    const result = await listAirtableRecords({
      secret,
      baseId: "appX",
      table: "Tasks",
      limit: 100,
      where: "test",
    });
    expect(result.truncated).toBe(false);
  });
});

describe("airtableFetch — errors (AF-M10-20)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("explains that PATs are scoped per base on a 403", async () => {
    // A token that works on another base is refused here, and Airtable's own
    // message does not say why.
    stubAirtable([{ body: { error: { message: "Forbidden" } }, status: 403 }]);
    const error = (await airtableFetch(secret, {
      baseId: "appX",
      table: "T",
      where: "test",
    }).catch((e) => e)) as Error;

    expect(error).toBeInstanceOf(NonRetriableError);
    expect(error.message).toMatch(/scoped per base/i);
  });

  it("shows the formula syntax on a rejected filter", async () => {
    stubAirtable([
      {
        body: { error: { type: "INVALID_FILTER_BY_FORMULA", message: "bad" } },
        status: 422,
      },
    ]);
    const error = (await airtableFetch(secret, {
      baseId: "appX",
      table: "T",
      where: "test",
    }).catch((e) => e)) as Error;
    expect(error.message).toContain("{Status}");
  });

  it("retries the per-base rate limit", async () => {
    stubAirtable([{ body: {}, status: 429 }]);
    await expect(
      airtableFetch(secret, { baseId: "appX", table: "T", where: "test" }),
    ).rejects.toBeInstanceOf(RetryAfterError);
  });

  it("refuses a node with no credential bound", async () => {
    await expect(
      airtableFetch(undefined, {
        baseId: "appX",
        table: "T",
        where: "Test node",
      }),
    ).rejects.toThrow(/no Airtable credential/i);
  });
});
