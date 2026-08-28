import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

// Network boundary is mocked: ky for the HTTP call, egress-guard's DNS/SSRF
// check for the endpoint. Template/status/channel logic runs for real.
const mockKy = vi.fn(
  async (_url: unknown, _options: unknown) =>
    new Response("ok", { status: 200, statusText: "OK" }),
);

vi.mock("ky", () => {
  const http = (url: unknown, options: unknown) => mockKy(url, options);
  // The Slack executor posts via ky.post; the node resolves the endpoint
  // through assertSafeEndpoint first.
  return {
    default: Object.assign(http, {
      post: (url: unknown, options: unknown) => mockKy(url, options),
    }),
  };
});

vi.mock("@/features/executions/components/http-request/egress-guard", () => ({
  assertSafeEndpoint: async (endpoint: string) => new URL(endpoint),
}));

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/slack", () => ({
  slackChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams => ({
  nodeId: "node_1",
  userId: "user_1",
  context: { data: { userId: "usr_123" } },
  step,
  publish,
  ...overrides,
});

describe("SLACK execute", () => {
  beforeEach(() => {
    mockKy.mockClear();
    publish.mockClear();
  });

  it("posts the decoded, templated message and stores it under the variable name", async () => {
    const params = makeParams({
      data: {
        variableName: "mySlack",
        webhookUrl: "https://hooks.example.com/verify",
        content: "Tom &amp; Jerry: hello {{data.userId}}",
      },
    });

    const result = await execute(params);

    expect(mockKy).toHaveBeenCalledTimes(1);
    const [argUrl, options] = mockKy.mock.calls[0] as [
      URL,
      { json?: { content?: string } },
    ];
    expect(argUrl.href).toBe("https://hooks.example.com/verify");
    expect(options.json).toEqual({ content: "Tom & Jerry: hello usr_123" });

    const stored = result.mySlack as { messageContent: string };
    expect(stored.messageContent).toBe("Tom & Jerry: hello usr_123");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("throws a non-retriable error when content is missing", async () => {
    const params = makeParams({ data: { variableName: "mySlack" } });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Slack node: Message content is required"),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the webhook URL is missing", async () => {
    const params = makeParams({ data: { content: "Hello" } });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Slack node: Webhook URL is required"),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the variable name is missing", async () => {
    const params = makeParams({
      data: {
        webhookUrl: "https://hooks.example.com/verify",
        content: "Hello",
      },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("Slack node: Variable name is missing"),
    );
    expect(mockKy).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("caps the stored message at 2000 characters", async () => {
    const params = makeParams({
      data: {
        variableName: "mySlack",
        webhookUrl: "https://hooks.example.com/long",
        content: "x".repeat(2500),
      },
    });

    const result = (await execute(params)) as {
      mySlack: { messageContent: string };
    };
    expect(result.mySlack.messageContent).toHaveLength(2000);
  });

  it("passes the webhookUrl through the egress guard as configured", async () => {
    // Current behavior: webhookUrl is guarded but not compiled, so a URL
    // template is percent-encoded rather than resolved. The message content
    // is the templated payload; the URL template support is a follow-up.
    const params = makeParams({
      data: {
        variableName: "mySlack",
        webhookUrl: "https://hooks.example.com/{{data.userId}}",
        content: "ping",
      },
    });

    await execute(params);

    const [argUrl] = mockKy.mock.calls[0] as [URL, unknown];
    expect(argUrl.href).toBe(
      "https://hooks.example.com/%7B%7Bdata.userId%7D%7D",
    );
  });
});
