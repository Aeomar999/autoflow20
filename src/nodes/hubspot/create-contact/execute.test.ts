import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { fetchMock, responseMock } = vi.hoisted(() => {
  const responseMock = {
    ok: true,
    status: 201,
    text: vi.fn(async () =>
      JSON.stringify({
        id: "1001",
        properties: {
          email: "ada@example.com",
          firstname: "Jane",
          lastname: "Doe",
          createdate: "2026-08-28T12:00:00.000Z",
        },
        createdAt: "2026-08-28T12:00:00.000Z",
        updatedAt: "2026-08-28T12:00:00.000Z",
        archived: false,
      }),
    ),
  };
  return {
    fetchMock: vi.fn(async () => responseMock),
    responseMock,
  };
});

// Network boundary is mocked: the HubSpot API is never contacted. The bearer
// token must reach the request headers and never leak into the run context.
vi.stubGlobal("fetch", fetchMock);

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/hubspot-create-contact", () => ({
  HUBSPOT_CREATE_CONTACT_CHANNEL_NAME: "hubspot-create-contact-execution",
  hubspotCreateContactChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const hubspotSecret = {
  apiKey: "pat-eu1.token-value",
};

const baseData = {
  variableName: "hubspotResult",
  credentialId: "cm_hubspot",
  properties:
    '{"email": "{{data.email}}", "firstname": "Jane", "lastname": "Doe"}',
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams => ({
  nodeId: "node_1",
  userId: "user_1",
  context: { data: { name: "Jane Doe", email: "ada@example.com" } },
  credentials: { credentialId: hubspotSecret },
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

describe("HUBSPOT_CREATE_CONTACT execute", () => {
  it("posts template-compiled properties with a bearer token and stores the contact", async () => {
    const result = await execute(makeParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];

    expect(url.pathname).toBe("/crm/v3/objects/contacts");
    expect(options.method).toBe("POST");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer pat-eu1.token-value",
    );

    const body = JSON.parse(String(options.body)) as {
      properties: { email: string; firstname: string; lastname: string };
    };
    expect(body.properties).toEqual({
      email: "ada@example.com",
      firstname: "Jane",
      lastname: "Doe",
    });

    const stored = result.hubspotResult as {
      id: string;
      createdAt: string;
      properties: { email: string };
    };
    expect(stored.id).toBe("1001");
    expect(stored.createdAt).toBe("2026-08-28T12:00:00.000Z");
    expect(stored.properties.email).toBe("ada@example.com");

    // The bearer token must not appear in the stored context or the trace.
    expect(JSON.stringify(result)).not.toContain("pat-eu1.token-value");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("compiles string property values through templates", async () => {
    await execute(
      makeParams({
        data: {
          ...baseData,
          properties: '{"firstname": "{{data.name}}"}',
        },
        context: {
          data: { name: "Grace Hopper", email: "ada@example.com" },
        },
      }),
    );

    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(options.body)) as {
      properties: { firstname: string };
    };
    expect(body.properties).toEqual({ firstname: "Grace Hopper" });
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    const params = makeParams({
      data: { ...baseData, variableName: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: Variable name not configured",
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
        "HubSpot Create Contact node: HubSpot credential not found",
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
        credentialId: { ...hubspotSecret, apiKey: "" },
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: HubSpot credential not found",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the credential id is not configured", async () => {
    const params = makeParams({
      data: { ...baseData, credentialId: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: HubSpot credential not configured",
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when properties is not a JSON object", async () => {
    await expect(
      execute(makeParams({ data: { ...baseData, properties: "not-json" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: Properties must be a JSON object",
      ),
    );

    await expect(
      execute(makeParams({ data: { ...baseData, properties: "[1, 2, 3]" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: Properties must be a JSON object",
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
        JSON.stringify({ message: "The authentication failed" }),
      ),
    });

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "HubSpot Create Contact node: API error 401: The authentication failed",
      ),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
