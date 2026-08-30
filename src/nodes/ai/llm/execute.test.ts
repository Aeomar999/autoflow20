import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";
import type { LlmData } from "./definition";

// Network boundary is mocked: the AI SDK provider factories are stubbed to
// plain model descriptors, and generateText/generateObject/jsonSchema resolve
// canned results. Registry resolution, template compilation, credential
// selection and error mapping run for real.
const {
  mockGenerateText,
  mockGenerateObject,
  mockJsonSchema,
  mockCreateOpenAI,
  mockCreateAnthropic,
  mockCreateGoogle,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(
    async (
      _options: Record<string, unknown>,
    ): Promise<{
      steps?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: Record<string, number>;
    }> => ({
      steps: [{ content: [{ type: "text", text: "42" }] }],
      usage: { promptTokens: 10, completionTokens: 5 },
    }),
  ),
  mockGenerateObject: vi.fn(
    async (
      _options: Record<string, unknown>,
    ): Promise<{
      object?: unknown;
      usage?: Record<string, number>;
    }> => ({
      object: { answer: 42 },
      usage: { promptTokens: 12, completionTokens: 6 },
    }),
  ),
  mockJsonSchema: vi.fn((schema: unknown) => schema),
  mockCreateOpenAI: vi.fn(),
  mockCreateAnthropic: vi.fn(),
  mockCreateGoogle: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  generateObject: mockGenerateObject,
  jsonSchema: mockJsonSchema,
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mockCreateAnthropic }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mockCreateGoogle,
}));

import { execute } from "./execute";

const step = {
  ai: {
    wrap: async <T>(
      _id: string,
      fn: (...args: unknown[]) => Promise<T>,
      ...args: unknown[]
    ): Promise<T> => fn(...args),
  },
} as unknown as NodeRunParams["step"];

const secret = { apiKey: "sk-integration-secret" };

const defaultData = {
  variableName: "chatReply",
  model: "openai:gpt-4o",
  systemPrompt: "You pitch the product {{data.product}}.",
  userPrompt: "Answer {{data.question}}",
};

type MakeParamsOverrides = Partial<Omit<NodeRunParams<LlmData>, "data">> & {
  data?: Partial<LlmData>;
};

const makeParams = (
  overrides: MakeParamsOverrides = {},
): NodeRunParams<LlmData> => {
  const { data: dataOverride, ...rest } = overrides;
  return {
    nodeId: "node_1",
    userId: "user_1",
    context: {
      data: { question: "6 times 7", product: "AutoFlow" },
      config: {},
    },
    credentials: { openaiCredentialId: secret },
    data: {
      temperature: 0.7,
      jsonMode: false,
      ...defaultData,
      ...dataOverride,
    } as LlmData,
    step,
    publish: vi.fn(async () => {}),
    ...rest,
  } as NodeRunParams<LlmData>;
};

const storedReply = <T>(result: Record<string, unknown>, key: string): T =>
  result[key] as T;

beforeEach(() => {
  mockGenerateText.mockClear();
  mockGenerateObject.mockClear();
  mockJsonSchema.mockClear();
  mockGenerateText.mockResolvedValue({
    steps: [{ content: [{ type: "text", text: "42" }] }],
    usage: { promptTokens: 10, completionTokens: 5 },
  });
  mockGenerateObject.mockResolvedValue({
    object: { answer: 42 },
    usage: { promptTokens: 12, completionTokens: 6 },
  });
  mockCreateOpenAI
    .mockClear()
    .mockReturnValue((modelId: string) => ({ providerId: "openai", modelId }));
  mockCreateAnthropic.mockClear().mockReturnValue((modelId: string) => ({
    providerId: "anthropic",
    modelId,
  }));
  mockCreateGoogle
    .mockClear()
    .mockReturnValue((modelId: string) => ({ providerId: "google", modelId }));
});

describe("AI_LLM execute", () => {
  it("generates text through the registered model and stores the reply", async () => {
    const result = await execute(makeParams());

    expect(mockJsonSchema).not.toHaveBeenCalled();
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-integration-secret",
      baseURL: undefined,
    });

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    > & { prompt: string; system: string };
    expect(callArgs.prompt).toBe("Answer 6 times 7");
    expect(callArgs.system).toBe("You pitch the product AutoFlow.");
    expect(callArgs.temperature).toBe(0.7);

    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.text).toBe("42");
    expect(reply.model).toBe("openai:gpt-4o");

    // The API key must never leak into the run context.
    expect(JSON.stringify(result)).not.toContain("sk-integration-secret");
  });

  it("passes maxOutputTokens through to the SDK when configured", async () => {
    await execute(makeParams({ data: { ...defaultData, maxTokens: 256 } }));

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(callArgs.maxOutputTokens).toBe(256);
    expect(callArgs.temperature).toBe(0.7);
  });

  it("resolves a bare provider id to its default model", async () => {
    const result = await execute(
      makeParams({ data: { ...defaultData, model: "groq" } }),
    );

    const callArgs = mockGenerateText.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(callArgs.prompt).toBe("Answer 6 times 7");
    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.model).toMatch(/^groq:/);
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-integration-secret",
      baseURL: "https://api.groq.com/openai/v1",
    });
  });

  it("routes google credentials to the gemini credential slot", async () => {
    await execute(
      makeParams({
        data: { ...defaultData, model: "google:gemini-1.5-pro" },
        credentials: { geminiCredentialId: { apiKey: "AIza-test" } },
      }),
    );

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: "AIza-test" });
    const callArgs = mockGenerateText.mock.calls[0]?.[0] as unknown as {
      model: { providerId: string; modelId: string };
    };
    expect(callArgs.model.providerId).toBe("google");
    expect(callArgs.model.modelId).toBe("gemini-1.5-pro");
  });

  it("routes anthropic credentials to the anthropic credential slot", async () => {
    await execute(
      makeParams({
        data: { ...defaultData, model: "anthropic:claude-3-5-sonnet" },
        credentials: { anthropicCredentialId: { apiKey: "sk-ant-test" } },
      }),
    );

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
    const callArgs = mockGenerateText.mock.calls[0]?.[0] as unknown as {
      model: { providerId: string; modelId: string };
    };
    expect(callArgs.model.providerId).toBe("anthropic");
    expect(callArgs.model.modelId).toBe("claude-3-5-sonnet");
  });

  it("generates a structured object in JSON mode", async () => {
    const result = await execute(
      makeParams({
        data: {
          ...defaultData,
          jsonMode: true,
          jsonSchema:
            '{"type":"object","properties":{"answer":{"type":"number"}}}',
        },
      }),
    );

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockJsonSchema).toHaveBeenCalledWith({
      type: "object",
      properties: { answer: { type: "number" } },
    });
    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.text).toBe(JSON.stringify({ answer: 42 }, null, 2));
    expect(reply.model).toBe("openai:gpt-4o");
  });

  it("throws a non-retriable error when JSON mode has no schema", async () => {
    await expect(
      execute(makeParams({ data: { ...defaultData, jsonMode: true } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Chat node: JSON mode requires a response JSON schema on the node",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the JSON schema is invalid", async () => {
    await expect(
      execute(
        makeParams({
          data: {
            ...defaultData,
            jsonMode: true,
            jsonSchema: "{not json",
          },
        }),
      ),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Chat node: configured response JSON schema is not valid JSON",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    await expect(
      execute(
        makeParams({ data: { ...defaultData, variableName: undefined } }),
      ),
    ).rejects.toThrow(
      new NonRetriableError("AI Chat node: Variable name is missing"),
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the user prompt is missing", async () => {
    await expect(
      execute(makeParams({ data: { ...defaultData, userPrompt: undefined } })),
    ).rejects.toThrow(new NonRetriableError("AI Chat node: Prompt is missing"));
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error for an unknown provider", async () => {
    await expect(
      execute(makeParams({ data: { ...defaultData, model: "wat:gpt-4o" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        'AI Chat node: unknown provider "wat". Configure a model like "openai:gpt-4o". Providers: openai, anthropic, google, groq, deepseek, ollama',
      ),
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("falls back to the provider default when the model is unknown", async () => {
    const result = await execute(
      makeParams({ data: { ...defaultData, model: "openai:nope" } }),
    );

    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.model).toBe("openai:gpt-4o-mini");
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("throws a non-retriable error when a keyed provider has no credential", async () => {
    await expect(
      execute(
        makeParams({
          credentials: {} as NodeRunParams["credentials"],
        }),
      ),
    ).rejects.toThrow(/credential required for provider "openai"/);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("runs openai-compatible providers without a credential using a local key", async () => {
    const result = await execute(
      makeParams({
        data: { ...defaultData, model: "ollama:mistral" },
        credentials: {} as NodeRunParams["credentials"],
      }),
    );

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "local",
      baseURL: "http://localhost:11434/v1",
    });
    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.model).toBe("ollama:mistral");
  });

  it("throws a non-retriable error when the model returns no text", async () => {
    mockGenerateText.mockResolvedValueOnce({
      steps: [{ content: [{ type: "tool-call", text: "" }] }],
    });

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError("AI Chat node: model returned an empty response"),
    );
  });

  it("falls back to secondary model when primary fails and records the served model", async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error("OpenAI 429 Too Many Requests"))
      .mockResolvedValueOnce({
        steps: [{ content: [{ type: "text", text: "Claude response" }] }],
      });

    const result = await execute(
      makeParams({
        data: {
          ...defaultData,
          model: "openai:gpt-4o",
          fallbackModels: "anthropic:claude-3-5-sonnet",
        },
        credentials: {
          openaiCredentialId: secret,
          anthropicCredentialId: { apiKey: "ant-secret" },
        },
      }),
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const reply = storedReply<{ text: string; model: string }>(
      result,
      "chatReply",
    );
    expect(reply.text).toBe("Claude response");
    expect(reply.model).toBe("anthropic:claude-3-5-sonnet");
  });

  it("throws detailed error when all candidates in fallback chain fail", async () => {
    mockGenerateText
      .mockRejectedValueOnce(new Error("OpenAI outage"))
      .mockRejectedValueOnce(new Error("Anthropic 503 Overloaded"));

    await expect(
      execute(
        makeParams({
          data: {
            ...defaultData,
            model: "openai:gpt-4o",
            fallbackModels: "anthropic:claude-3-5-sonnet",
          },
          credentials: {
            openaiCredentialId: secret,
            anthropicCredentialId: { apiKey: "ant-secret" },
          },
        }),
      ),
    ).rejects.toThrow(
      /AI Chat node: all candidate models in fallback chain failed: \[openai:gpt-4o\]: OpenAI outage; \[anthropic:claude-3-5-sonnet\]: Anthropic 503 Overloaded/,
    );
  });

  it("captures token usage and calculates cost under __usage", async () => {
    mockGenerateText.mockResolvedValueOnce({
      steps: [{ content: [{ type: "text", text: "Answer text" }] }],
      usage: { promptTokens: 1000, completionTokens: 500 },
    });

    const result = await execute(
      makeParams({
        data: {
          ...defaultData,
          model: "openai:gpt-4o",
        },
      }),
    );

    const usage = result.__usage as {
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      model: string;
    };
    expect(usage).toBeDefined();
    expect(usage.tokensIn).toBe(1000);
    expect(usage.tokensOut).toBe(500);
    expect(usage.model).toBe("openai:gpt-4o");
    // gpt-4o pricing: $2.50 / 1M in, $10.00 / 1M out -> (1000*2.5 + 500*10)/1e6 = 0.0075
    expect(usage.costUsd).toBe(0.0075);
  });
});
