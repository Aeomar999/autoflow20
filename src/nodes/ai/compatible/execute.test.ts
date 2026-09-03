import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

// Network boundary is mocked: ky for the HTTP call, egress-guard's DNS/SSRF
// check for the endpoint. Template/status/channel logic runs for real.
const mockKy = vi.fn(
  async (_url: URL, _options: unknown) =>
    new Response(
      JSON.stringify({
        id: "chatcmpl-123",
        model: "llama-3.3-70b-versatile",
        choices: [{ message: { content: "42" } }],
        usage: { prompt_tokens: 11, completion_tokens: 2 },
      }),
      {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      },
    ),
);

vi.mock("ky", () => ({
  default: (url: URL, options: unknown) => mockKy(url, options),
}));

vi.mock("@/features/executions/components/http-request/egress-guard", () => ({
  assertSafeEndpoint: vi.fn(async (endpoint: string) => new URL(endpoint)),
  readCappedText: async (response: Response) => response.text(),
  resolveTimeoutMs: (timeoutMs?: number) => timeoutMs ?? 10_000,
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init),
}));

// The realtime sender is an infra binding; stub it to a plain payload so the
// executor's publish calls are assertable. Channel wiring is covered by the
// realtime subscription layer.
vi.mock("@/inngest/channels/openai-compatible-chat", () => ({
  OPENAI_COMPATIBLE_CHAT_CHANNEL_NAME: "openai-compatible-chat-execution",
  openAiCompatibleChatChannel: () => ({
    status: (payload: unknown) => payload,
  }),
}));

import { assertSafeEndpoint } from "@/features/executions/components/http-request/egress-guard";
import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const secret = {
  apiKey: "gsk_secret-token",
};

const baseData = {
  variableName: "chatReply",
  credentialId: "cm_openai_compatible",
  baseUrl: "https://api.groq.com/openai/v1",
  model: "llama-3.3-70b-versatile",
  systemPrompt: "You are a terse assistant.",
  userPrompt: "What is 6 times 7?",
};

const makeParams = (overrides: Partial<NodeRunParams> = {}): NodeRunParams =>
  withResolve({
    nodeId: "node_1",
    userId: "user_1",
    context: {
      data: { question: "6 times 7", workspace: "verify" },
      config: { baseUrl: "openai/v1" },
    },
    credentials: { credentialId: secret },
    data: baseData,
    step,
    publish,
    ...overrides,
  });

beforeEach(() => {
  mockKy.mockClear();
  mockKy.mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "chatcmpl-123",
        model: "llama-3.3-70b-versatile",
        choices: [{ message: { content: "42" } }],
        usage: { prompt_tokens: 11, completion_tokens: 2 },
      }),
      {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
      },
    ),
  );
  (assertSafeEndpoint as ReturnType<typeof vi.fn>).mockClear();
  (assertSafeEndpoint as ReturnType<typeof vi.fn>).mockResolvedValue(
    new URL("https://api.groq.com/openai/v1"),
  );
});

describe("OPENAI_COMPATIBLE_CHAT execute", () => {
  it("posts a chat completion with a bearer token and stores the reply", async () => {
    const result = await execute(makeParams());

    expect(mockKy).toHaveBeenCalledTimes(1);
    const [argUrl, options] = mockKy.mock.calls[0] as [
      URL,
      Record<string, unknown>,
    ];

    expect(new URL(String(argUrl)).href).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    expect(options.method).toBe("POST");
    expect(options.timeout).toBe(10_000);
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Bearer gsk_secret-token",
    );

    const body = options.json as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("llama-3.3-70b-versatile");
    expect(body.messages).toEqual([
      { role: "system", content: "You are a terse assistant." },
      { role: "user", content: "What is 6 times 7?" },
    ]);

    const stored = result.chatReply as {
      id: string;
      model: string;
      text: string;
      usage: { promptTokens: number; completionTokens: number };
    };
    expect(stored.id).toBe("chatcmpl-123");
    expect(stored.model).toBe("llama-3.3-70b-versatile");
    expect(stored.text).toBe("42");
    expect(stored.usage).toEqual({ promptTokens: 11, completionTokens: 2 });
    expect(result.__usage).toEqual({
      tokensIn: 11,
      tokensOut: 2,
      costUsd: 0,
      model: "llama-3.3-70b-versatile",
    });

    // The API key must never leak into the run context.
    expect(JSON.stringify(result)).not.toContain("gsk_secret-token");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "loading" }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success" }),
    );
  });

  it("resolves baseUrl and prompts through templates", async () => {
    await execute(
      makeParams({
        data: {
          ...baseData,
          baseUrl: "https://api.groq.com/{{config.baseUrl}}",
          systemPrompt: "You pitch the workspace {{data.workspace}}.",
          userPrompt: "Answer {{data.question}}",
        },
      }),
    );

    const [argUrl, options] = mockKy.mock.calls[0] as [
      URL,
      Record<string, unknown>,
    ];
    expect(new URL(String(argUrl)).href).toBe(
      "https://api.groq.com/openai/v1/chat/completions",
    );
    const body = options.json as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toEqual([
      { role: "system", content: "You pitch the workspace verify." },
      { role: "user", content: "Answer 6 times 7" },
    ]);
  });

  it("sends only the user message when no system prompt is configured", async () => {
    await execute(makeParams({ data: { ...baseData, systemPrompt: "" } }));

    const [, options] = mockKy.mock.calls[0] as [URL, Record<string, unknown>];
    const body = options.json as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages).toEqual([
      { role: "user", content: "What is 6 times 7?" },
    ]);
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    const params = makeParams({
      data: { ...baseData, variableName: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: Variable name not configured",
      ),
    );
    expect(mockKy).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential is not found", async () => {
    const params = makeParams({ credentials: undefined });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: OpenAI-compatible credential not found",
      ),
    );
    expect(mockKy).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("throws a non-retriable error when the credential carries no API key", async () => {
    const params = makeParams({
      credentials: { credentialId: { ...secret, apiKey: "" } },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: OpenAI-compatible credential not found",
      ),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when baseUrl is missing", async () => {
    const params = makeParams({
      data: { ...baseData, baseUrl: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("OpenAI-Compatible node: Base URL not configured"),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when model is missing", async () => {
    const params = makeParams({
      data: { ...baseData, model: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("OpenAI-Compatible node: Model not configured"),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the user prompt is missing", async () => {
    const params = makeParams({
      data: { ...baseData, userPrompt: undefined },
    });

    await expect(execute(params)).rejects.toThrow(
      new NonRetriableError("OpenAI-Compatible node: Prompt not configured"),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("surfaces API errors (e.g. invalid token) as non-retriable with the message", async () => {
    mockKy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { message: "Invalid API key provided" },
        }),
        { status: 401, statusText: "Unauthorized" },
      ),
    );

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: API error 401: Invalid API key provided",
      ),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("surfaces non-JSON API errors with the status line", async () => {
    mockKy.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: API error 502: HTTP 502 Bad Gateway",
      ),
    );
  });

  it("drops a blocked base url before any request leaves the runner", async () => {
    (assertSafeEndpoint as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new NonRetriableError("HTTP Request node: Blocked endpoint"),
    );

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError("HTTP Request node: Blocked endpoint"),
    );
    expect(mockKy).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the response is missing a completion", async () => {
    mockKy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "chatcmpl-123", choices: [] }), {
        status: 200,
        statusText: "OK",
      }),
    );

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "OpenAI-Compatible node: response is missing a chat completion",
      ),
    );
  });
});
