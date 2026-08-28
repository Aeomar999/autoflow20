import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { mockClient, mockClientInstance } = vi.hoisted(() => {
  const mockClientInstance = {
    connect: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows: [{ ok: true }], rowCount: 1 })),
    end: vi.fn(async () => {}),
  };
  return {
    mockClient: vi.fn(() => mockClientInstance),
    mockClientInstance,
  };
});

// Network boundary is mocked: pg never connects. The mock must be a regular
// `function` (not arrow, not class) so the executor's `new Client(...)` works —
// arrows are not constructible and class constructors may not return objects.
// Templating, validation, and channel publishing run for real.
vi.mock("pg", () => ({
  // biome-ignore lint/complexity/useArrowFunction: must remain a constructible function
  Client: function (config: unknown) {
    return mockClient(config);
  },
}));

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/postgres-query", () => ({
  POSTGRES_QUERY_CHANNEL_NAME: "postgres-query-execution",
  postgresQueryChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const postgresSecret = {
  host: "db.example.com",
  port: "5432",
  database: "app",
  username: "app_user",
  password: "relay-pass",
  ssl: undefined,
};

const baseData = {
  variableName: "queryResult",
  credentialId: "cm_postgres",
  query: "SELECT * FROM users WHERE id = $1 AND active = $2",
  params: '["{{data.userId}}", true]',
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams => ({
  nodeId: "node_1",
  userId: "user_1",
  context: { data: { userId: "usr_123" } },
  credentials: { credentialId: postgresSecret },
  data: baseData,
  step,
  publish,
  ...overrides,
});

beforeEach(() => {
  mockClient.mockClear();
  mockClientInstance.connect.mockClear();
  mockClientInstance.query.mockClear();
  mockClientInstance.end.mockClear();
});

describe("POSTGRES_QUERY execute", () => {
  it("runs a parameterized query, binds compiled params, and stores the rows", async () => {
    const result = await execute(makeParams());

    expect(mockClient).toHaveBeenCalledWith({
      host: "db.example.com",
      port: 5432,
      database: "app",
      user: "app_user",
      password: "relay-pass",
      ssl: undefined,
      connectionTimeoutMillis: 10_000,
      query_timeout: 30_000,
    });

    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1);
    // Values are bound as parameters — the statement text is never rewritten.
    expect(mockClientInstance.query).toHaveBeenCalledWith({
      text: "SELECT * FROM users WHERE id = $1 AND active = $2",
      values: ["usr_123", true],
    });
    expect(mockClientInstance.end).toHaveBeenCalled();

    const stored = result.queryResult as {
      rows: Array<{ ok: boolean }>;
      rowCount: number;
      truncated: boolean;
    };
    expect(stored.rows).toEqual([{ ok: true }]);
    expect(stored.rowCount).toBe(1);
    expect(stored.truncated).toBe(false);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("enables ssl when the credential requires it", async () => {
    await execute(
      makeParams({
        credentials: { credentialId: { ...postgresSecret, ssl: "require" } },
      }),
    );
    expect(mockClient).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: { rejectUnauthorized: false } }),
    );
  });

  it("throws a non-retriable error when params is not a JSON array", async () => {
    await expect(
      execute(makeParams({ data: { ...baseData, params: "not-json" } })),
    ).rejects.toThrow(
      new NonRetriableError("Postgres node: Params must be a JSON array"),
    );

    await expect(
      execute(makeParams({ data: { ...baseData, params: '{"foo": 1}' } })),
    ).rejects.toThrow(
      new NonRetriableError("Postgres node: Params must be a JSON array"),
    );

    expect(mockClientInstance.connect).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the query is missing", async () => {
    const params = makeParams({
      data: { ...baseData, query: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Postgres node: No query configured"),
    );
    expect(mockClientInstance.connect).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential is not found", async () => {
    const params = makeParams({ credentials: undefined });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Postgres node: Postgres credential not found"),
    );
    expect(mockClient).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
