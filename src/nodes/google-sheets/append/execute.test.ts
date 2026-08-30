import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { fetchMock, responseMock } = vi.hoisted(() => {
  const responseMock = {
    ok: true,
    status: 200,
    text: vi.fn(async () =>
      JSON.stringify({
        spreadsheetId: "sheet_1",
        tableRange: "Sheet1!A1:C4",
        updates: {
          updatedRange: "Sheet1!A5:C5",
          updatedRows: 1,
          updatedColumns: 3,
          updatedCells: 3,
        },
      }),
    ),
  };
  return {
    fetchMock: vi.fn(async () => responseMock),
    responseMock,
  };
});

// Network boundary is mocked: the Sheets API is never contacted. The bearer
// token must reach the request headers and never leak into the run context.
vi.stubGlobal("fetch", fetchMock);

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/google-sheets-append", () => ({
  GOOGLE_SHEETS_APPEND_CHANNEL_NAME: "google-sheets-append-execution",
  googleSheetsAppendChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const googleSecret = {
  accessToken: "ya29.token-value",
  scopes: "https://www.googleapis.com/auth/spreadsheets",
};

const baseData = {
  variableName: "appendResult",
  credentialId: "cm_google",
  spreadsheetId: "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
  sheetName: "Sheet1",
  values: '[["{{data.email}}", "Jane", 42], ["row", "b", true]]',
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams => ({
  nodeId: "node_1",
  userId: "user_1",
  context: { data: { email: "ada@example.com" } },
  credentials: { credentialId: googleSecret },
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

describe("GOOGLE_SHEETS_APPEND execute", () => {
  it("appends template-compiled rows with a bearer token and stores the result", async () => {
    const result = await execute(makeParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];

    expect(url.pathname).toBe(
      "/v4/spreadsheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/values/Sheet1:append",
    );
    expect(url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer ya29.token-value",
    );
    expect(options.body).toContain('["ada@example.com","Jane",42]');

    const stored = result.appendResult as {
      spreadsheetId: string;
      tableRange: string;
      updates: { updatedRange: string; updatedRows: number };
    };
    expect(stored.spreadsheetId).toBe("sheet_1");
    expect(stored.tableRange).toBe("Sheet1!A1:C4");
    expect(stored.updates).toEqual({
      updatedRange: "Sheet1!A5:C5",
      updatedRows: 1,
      updatedColumns: 3,
      updatedCells: 3,
    });

    // The bearer token must not appear in the stored context or the trace.
    expect(JSON.stringify(result)).not.toContain("ya29.token-value");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("resolves the spreadsheet id and sheet range through templates", async () => {
    await execute(
      makeParams({
        data: {
          ...baseData,
          spreadsheetId: "{{config.spreadsheetId}}",
          sheetName: "{{config.sheetName}}!A2:C",
        },
        context: {
          data: { email: "ada@example.com" },
          config: { spreadsheetId: "tmpl_sheet", sheetName: "Leads" },
        },
      }),
    );

    const [url] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toContain("/values/Leads!A2:C:append");
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    const params = makeParams({
      data: { ...baseData, variableName: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: Variable name not configured",
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
        "Google Sheets Append node: Google credential not found",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential carries no access token", async () => {
    const params = makeParams({
      credentials: {
        credentialId: { ...googleSecret, accessToken: "" },
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: Google credential not found",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when values is not a JSON array of rows", async () => {
    await expect(
      execute(makeParams({ data: { ...baseData, values: "not-json" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: Values must be a JSON array of rows",
      ),
    );

    await expect(
      execute(makeParams({ data: { ...baseData, values: '{"foo": 1}' } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: Values must be a JSON array of rows",
      ),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("surfaces API errors (e.g. expired token) as non-retriable with status", async () => {
    fetchMock.mockResolvedValueOnce({
      ...responseMock,
      ok: false,
      status: 401,
      text: vi.fn(async () => '{"error":{"message":"invalid_grant"}}'),
    });

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: API error 401: invalid_grant",
      ),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the spreadsheets are not configured", async () => {
    const params = makeParams({
      data: { ...baseData, spreadsheetId: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Google Sheets Append node: Spreadsheet ID not configured",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
