import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

// Network boundary is mocked: ky for the HTTP call, egress-guard's DNS/SSRF
// check for the endpoint. Template/status/channel logic runs for real.
const mockKy = vi.fn(
  async (_url: URL, _options: unknown) =>
    new Response('{"ok":true}', {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
    }),
);

vi.mock("ky", () => ({
  default: (url: URL, options: unknown) => mockKy(url, options),
}));

vi.mock("@/features/executions/components/http-request/egress-guard", () => ({
  assertSafeEndpoint: async (endpoint: string) => new URL(endpoint),
  readCappedText: async (response: Response) => response.text(),
  resolveTimeoutMs: (timeoutMs?: number) => timeoutMs ?? 10_000,
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/webhook-out", () => ({
  WEBHOOK_OUT_CHANNEL_NAME: "webhook-out-execution",
  webhookOutChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams =>
  withResolve({
    nodeId: "node_1",
    userId: "user_1",
    context: { data: { userId: "usr_123" } },
    data: {
      variableName: "delivery",
      url: "https://example.com/hook",
      body: '{"event": "created", "userId": "{{data.userId}}"}',
    },
    step,
    publish,
    ...overrides,
  });

describe("WEBHOOK_OUT execute", () => {
  it("posts the templated payload and stores the delivery response", async () => {
    mockKy.mockClear();
    const params = makeParams({
      data: {
        variableName: "delivery",
        url: "https://example.com/hook/{{data.userId}}",
        body: '{"event": "created", "userId": "{{data.userId}}"}',
      },
    });

    const result = await execute(params);

    expect(mockKy).toHaveBeenCalledTimes(1);
    const [argUrl, options] = mockKy.mock.calls[0] as [URL, RequestInit];
    expect(argUrl.href).toBe("https://example.com/hook/usr_123");
    expect(options.method).toBe("POST");
    expect(options.body).toBe('{"event": "created", "userId": "usr_123"}');
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );

    const stored = result.delivery as {
      webhookResponse: { status: number; statusText: string; data: unknown };
    };
    expect(stored.webhookResponse.status).toBe(200);
    expect(stored.webhookResponse.data).toEqual({ ok: true });

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("honors an explicit Content-Type header", async () => {
    mockKy.mockClear();
    const params = makeParams({
      data: {
        variableName: "delivery",
        url: "https://example.com/hook",
        headers: { "Content-Type": "text/plain" },
        body: '{"a":1}',
      },
    });

    await execute(params);

    const [, options] = mockKy.mock.calls[0] as [URL, RequestInit];
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe(
      "text/plain",
    );
  });

  it("throws a non-retriable error when the URL is missing", async () => {
    const params = makeParams({
      data: { variableName: "delivery" },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Webhook node: No URL configured"),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error for malformed JSON after templating", async () => {
    const params = makeParams({
      data: {
        variableName: "delivery",
        url: "https://example.com/hook",
        body: "{{data.raw}}",
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "Webhook node: request body must be valid JSON after templating",
      ),
    );
  });
});
