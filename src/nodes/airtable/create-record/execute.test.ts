import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { fetchMock, responseMock } = vi.hoisted(() => {
  const responseMock = {
    ok: true,
    status: 200,
    text: vi.fn(async () =>
      JSON.stringify({
        id: "recHOME1",
        createdTime: "2026-08-28T12:00:00.000Z",
        fields: {
          Name: "Jane Doe",
          Email: "ada@example.com",
          Score: 42,
        },
      }),
    ),
  };
  return {
    fetchMock: vi.fn(async () => responseMock),
    responseMock,
  };
});

// Network boundary is mocked: the Airtable API is never contacted. The bearer
// token must reach the request headers and never leak into the run context.
vi.stubGlobal("fetch", fetchMock);

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/airtable-create-record", () => ({
  AIRTABLE_CREATE_RECORD_CHANNEL_NAME: "airtable-create-record-execution",
  airtableCreateRecordChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const airtableSecret = {
  apiKey: "pat.token-value",
};

const baseData = {
  variableName: "airtableResult",
  credentialId: "cm_airtable",
  baseId: "appTESTBASE",
  tableId: "tblLeads",
  fields: '{"Name": "{{data.name}}", "Email": "{{data.email}}", "Score": 42}',
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams =>
  withResolve({
    nodeId: "node_1",
    userId: "user_1",
    context: { data: { name: "Jane Doe", email: "ada@example.com" } },
    credentials: { credentialId: airtableSecret },
    data: baseData,
    step,
    publish,
    ...overrides,
  });

beforeEach(() => {
  fetchMock.mockClear();
  responseMock.text.mockClear();
  fetchMock.mockResolvedValue(responseMock);
});

describe("AIRTABLE_CREATE_RECORD execute", () => {
  it("posts template-compiled fields with a bearer token and stores the record", async () => {
    const result = await execute(makeParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];

    expect(url.pathname).toBe("/v0/appTESTBASE/tblLeads");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer pat.token-value",
    );

    const body = JSON.parse(String(options.body)) as {
      fields: { Name: string; Email: string; Score: number };
    };
    expect(body.fields).toEqual({
      Name: "Jane Doe",
      Email: "ada@example.com",
      Score: 42,
    });

    const stored = result.airtableResult as {
      id: string;
      createdTime: string;
      fields: { Name: string };
    };
    expect(stored.id).toBe("recHOME1");
    expect(stored.createdTime).toBe("2026-08-28T12:00:00.000Z");
    expect(stored.fields).toEqual({
      Name: "Jane Doe",
      Email: "ada@example.com",
      Score: 42,
    });

    // The bearer token must not appear in the stored context or the trace.
    expect(JSON.stringify(result)).not.toContain("pat.token-value");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("resolves the base id and table id through templates", async () => {
    await execute(
      makeParams({
        data: {
          ...baseData,
          baseId: "{{config.baseId}}",
          tableId: "{{config.tableId}}",
        },
        context: {
          data: { name: "Jane Doe", email: "ada@example.com" },
          config: { baseId: "appTMPl", tableId: "Leads All" },
        },
      }),
    );

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/v0/appTMPl/Leads%20All");
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    const params = makeParams({
      data: { ...baseData, variableName: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Variable name not configured",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential is not found", async () => {
    const params = makeParams({ credentials: undefined });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Airtable credential not found",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential carries no API key", async () => {
    const params = makeParams({
      credentials: {
        credentialId: { ...airtableSecret, apiKey: "" },
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Airtable credential not found",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when fields is not a JSON object", async () => {
    await expect(
      execute(makeParams({ data: { ...baseData, fields: "not-json" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Fields must be a JSON object",
      ),
    );

    await expect(
      execute(makeParams({ data: { ...baseData, fields: "[1, 2, 3]" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Fields must be a JSON object",
      ),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("surfaces API errors (e.g. invalid token) as non-retriable with status", async () => {
    fetchMock.mockResolvedValueOnce({
      ...responseMock,
      ok: false,
      status: 401,
      text: vi.fn(async () =>
        JSON.stringify({
          error: { type: "AUTHENTICATION_REQUIRED", message: "invalid key" },
        }),
      ),
    });

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: API error 401: invalid key",
      ),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the base id is not configured", async () => {
    const params = makeParams({
      data: { ...baseData, baseId: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Airtable Create Record node: Base ID not configured",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
