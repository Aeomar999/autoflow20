import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { NodeRunParams } from "@/nodes/types";
import type { ExtractData } from "./definition";
import {
  buildExtractionSchema,
  buildOutputSchema,
  execute,
  parseStructuredSchema,
} from "./execute";

// Network boundary is mocked: the AI SDK provider factories are stubbed to
// plain model descriptors, and generateObject/jsonSchema resolve canned
// results. Registry resolution, template compilation, schema building,
// credential selection and error mapping run for real.
const {
  mockGenerateObject,
  mockJsonSchema,
  mockCreateOpenAI,
  mockCreateAnthropic,
  mockCreateGoogle,
} = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(
    async (
      _options: Record<string, unknown>,
    ): Promise<{
      object?: unknown;
      usage?: Record<string, number>;
    }> => ({
      object: null,
      usage: undefined,
    }),
  ),
  mockJsonSchema: vi.fn((schema: unknown) => schema),
  mockCreateOpenAI: vi.fn(),
  mockCreateAnthropic: vi.fn(),
  mockCreateGoogle: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  generateObject: mockGenerateObject,
  jsonSchema: mockJsonSchema,
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mockCreateOpenAI }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: mockCreateAnthropic }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mockCreateGoogle,
}));

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
  variableName: "extracted",
  model: "openai:gpt-4o",
  content: "{{data.invoice}}",
  fields: [
    { name: "amount", type: "number", description: "The invoice total" },
    { name: "vendor", type: "string", description: "The vendor name" },
  ],
} as const;

type MakeParamsOverrides = Partial<Omit<NodeRunParams<ExtractData>, "data">> & {
  data?: Partial<ExtractData>;
};

const makeParams = (
  overrides: MakeParamsOverrides = {},
): NodeRunParams<ExtractData> => {
  const { data: dataOverride, ...rest } = overrides;
  return withResolve({
    nodeId: "node_1",
    userId: "user_1",
    context: {
      data: { invoice: "Invoice #12 — Total: $120.00 from ACME Corp" },
      config: {},
    },
    credentials: { openaiCredentialId: secret },
    data: {
      ...defaultData,
      ...dataOverride,
    } as ExtractData,
    step,
    publish: vi.fn(async () => {}),
    ...rest,
  }) as NodeRunParams<ExtractData>;
};

const storedObject = <T>(result: Record<string, unknown>, key: string): T =>
  result[key] as T;

beforeEach(() => {
  mockGenerateObject.mockClear();
  mockJsonSchema.mockClear();
  mockGenerateObject.mockResolvedValue({
    object: { amount: 120, vendor: "ACME Corp" },
    usage: { promptTokens: 500, completionTokens: 100 },
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

describe("AI_EXTRACT execute", () => {
  it("extracts a structured object and stores it under the variable name", async () => {
    const result = await execute(makeParams());

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-integration-secret",
      baseURL: undefined,
    });

    const callArgs = mockGenerateObject.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    > & { prompt: string };
    expect(callArgs.prompt).toContain("Invoice #12 — Total: $120.00");

    expect(mockJsonSchema).toHaveBeenCalledWith({
      type: "object",
      additionalProperties: false,
      properties: {
        amount: { type: "number", description: "The invoice total" },
        vendor: { type: "string", description: "The vendor name" },
      },
      required: ["amount", "vendor"],
    });

    const extracted = storedObject<{ amount: number; vendor: string }>(
      result,
      "extracted",
    );
    expect(extracted).toEqual({ amount: 120, vendor: "ACME Corp" });

    // The API key must never leak into the run context.
    expect(JSON.stringify(result)).not.toContain("sk-integration-secret");
  });

  it("resolves a bare provider id to its default model", async () => {
    const result = await execute(makeParams({ data: { model: "groq" } }));

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "sk-integration-secret",
      baseURL: "https://api.groq.com/openai/v1",
    });
    expect(mockJsonSchema).toHaveBeenCalled();
    const bareExtracted = storedObject<{ amount: number; vendor: string }>(
      result,
      "extracted",
    );
    expect(bareExtracted).toEqual({ amount: 120, vendor: "ACME Corp" });
  });

  it("routes google credentials to the gemini credential slot", async () => {
    await execute(
      makeParams({
        data: { model: "google:gemini-3.6-flash" },
        credentials: { geminiCredentialId: { apiKey: "AIza-test" } },
      }),
    );

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: "AIza-test" });
    const callArgs = mockGenerateObject.mock.calls[0]?.[0] as unknown as {
      model: { providerId: string; modelId: string };
    };
    expect(callArgs.model.providerId).toBe("google");
    expect(callArgs.model.modelId).toBe("gemini-3.6-flash");
  });

  it("routes anthropic credentials to the anthropic credential slot", async () => {
    await execute(
      makeParams({
        data: { model: "anthropic:claude-3-5-sonnet" },
        credentials: { anthropicCredentialId: { apiKey: "sk-ant-test" } },
      }),
    );

    expect(mockCreateAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-test" });
    const callArgs = mockGenerateObject.mock.calls[0]?.[0] as unknown as {
      model: { providerId: string; modelId: string };
    };
    expect(callArgs.model.providerId).toBe("anthropic");
    expect(callArgs.model.modelId).toBe("claude-3-5-sonnet");
  });

  it("throws a non-retriable error when variableName is missing", async () => {
    await expect(
      execute(makeParams({ data: { variableName: undefined } })),
    ).rejects.toThrow(
      new NonRetriableError("AI Extract node: Variable name is missing"),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when source content is missing", async () => {
    await expect(
      execute(makeParams({ data: { content: undefined } })),
    ).rejects.toThrow(
      // AF-M10-07 widened the message: an attachment is now an alternative to
      // text content, so the error names both ways out.
      /Source content is missing/,
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when neither a field list nor a JSON schema is configured", async () => {
    await expect(
      execute(
        makeParams({ data: { fields: undefined, jsonSchema: undefined } }),
      ),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Extract node: configure either an extraction schema (JSON) or at least one extraction field",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when content resolves to an empty value", async () => {
    await expect(
      execute(
        makeParams({
          context: { data: { invoice: "" }, config: {} },
        }),
      ),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Extract node: source content resolved to an empty value",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error for an unknown provider", async () => {
    await expect(
      execute(makeParams({ data: { model: "wat:gpt-4o" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        'AI Extract node: unknown provider "wat". Configure a model like "openai:gpt-4o". Providers: openai, anthropic, google, groq, deepseek, ollama',
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("falls back to the provider default when the model is unknown", async () => {
    const result = await execute(
      makeParams({ data: { model: "openai:nope" } }),
    );

    expect(mockJsonSchema).toHaveBeenCalled();
    const bareExtracted = storedObject<{ amount: number; vendor: string }>(
      result,
      "extracted",
    );
    expect(bareExtracted).toEqual({ amount: 120, vendor: "ACME Corp" });
  });

  it("throws a non-retriable error when a keyed provider has no credential", async () => {
    await expect(
      execute(
        makeParams({
          credentials: {} as NodeRunParams["credentials"],
        }),
      ),
    ).rejects.toThrow(/credential required for provider "openai"/);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("runs openai-compatible providers without a credential using a local key", async () => {
    await execute(
      makeParams({
        data: { model: "ollama:mistral" },
        credentials: {} as NodeRunParams["credentials"],
      }),
    );

    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "local",
      baseURL: "http://localhost:11434/v1",
    });
    expect(mockJsonSchema).toHaveBeenCalled();
  });

  it("throws a non-retriable error on duplicate field names", async () => {
    await expect(
      execute(
        makeParams({
          data: {
            fields: [
              { name: "amount", type: "number" },
              { name: "amount", type: "string" },
            ],
          },
        }),
      ),
    ).rejects.toThrow(
      new NonRetriableError('AI Extract node: duplicate field name "amount"'),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("uses a pasted JSON schema instead of the field list when both are set", async () => {
    await execute(
      makeParams({
        data: {
          jsonSchema: JSON.stringify({
            type: "object",
            additionalProperties: false,
            properties: { total: { type: "number" } },
            required: ["total"],
          }),
        },
      }),
    );

    expect(mockJsonSchema).toHaveBeenCalledWith({
      type: "object",
      additionalProperties: false,
      properties: { total: { type: "number" } },
      required: ["total"],
    });
  });

  it("trims surrounding whitespace from a pasted schema", async () => {
    await execute(
      makeParams({ data: { jsonSchema: '  {"type":"object"}  ' } }),
    );

    expect(mockJsonSchema).toHaveBeenCalledWith({ type: "object" });
  });

  it("throws a non-retriable error when the pasted JSON schema is not valid JSON", async () => {
    await expect(
      execute(makeParams({ data: { jsonSchema: "{ not valid" } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Extract node: extraction schema is not valid JSON",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("rejects a pasted schema that is not a top-level object schema", async () => {
    await expect(
      execute(makeParams({ data: { jsonSchema: '{"type":"string"}' } })),
    ).rejects.toThrow(
      new NonRetriableError(
        'AI Extract node: extraction schema must have "type": "object" at the top level so the model returns a JSON object',
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("rejects a pasted schema that parses to a JSON array", async () => {
    await expect(
      execute(makeParams({ data: { jsonSchema: '["a","b"]' } })),
    ).rejects.toThrow(
      new NonRetriableError(
        "AI Extract node: extraction schema must be a JSON object",
      ),
    );
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("throws a non-retriable error when the model returns no structured output", async () => {
    mockGenerateObject.mockResolvedValueOnce({ object: null });

    await expect(execute(makeParams())).rejects.toThrow(
      new NonRetriableError(
        "AI Extract node: model returned no structured output",
      ),
    );
  });

  it("falls back to secondary model when primary fails during extraction", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("OpenAI 429 Too Many Requests"))
      .mockResolvedValueOnce({
        object: { amount: 250, vendor: "Fallback Supplier" },
      });

    const result = await execute(
      makeParams({
        data: {
          model: "openai:gpt-4o",
          fallbackModels: "anthropic:claude-3-5-sonnet",
        },
        credentials: {
          openaiCredentialId: secret,
          anthropicCredentialId: { apiKey: "ant-secret" },
        },
      }),
    );

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    const extracted = storedObject<{ amount: number; vendor: string }>(
      result,
      "extracted",
    );
    expect(extracted).toEqual({ amount: 250, vendor: "Fallback Supplier" });
  });

  it("throws detailed error when all extraction candidate models fail", async () => {
    mockGenerateObject
      .mockRejectedValueOnce(new Error("OpenAI Rate limited"))
      .mockRejectedValueOnce(new Error("Anthropic Overloaded"));

    await expect(
      execute(
        makeParams({
          data: {
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
      /AI Extract node: all candidate models in fallback chain failed: \[openai:gpt-4o\]: OpenAI Rate limited; \[anthropic:claude-3-5-sonnet\]: Anthropic Overloaded/,
    );
  });

  it("captures token usage and calculates cost under __usage", async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { amount: 120, vendor: "ACME Corp" },
      usage: { promptTokens: 2000, completionTokens: 400 },
    });

    const result = await execute(
      makeParams({
        data: {
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
    expect(usage.tokensIn).toBe(2000);
    expect(usage.tokensOut).toBe(400);
    expect(usage.model).toBe("openai:gpt-4o");
    // gpt-4o: $2.50 / 1M in, $10.00 / 1M out -> (2000*2.5 + 400*10)/1e6 = 0.009
    expect(usage.costUsd).toBe(0.009);
  });
});

describe("buildExtractionSchema", () => {
  it("builds a strict object schema with every field required", () => {
    const schema = buildExtractionSchema([
      { name: "amount", type: "number", description: "Invoice total" },
      { name: "paid", type: "boolean" },
    ]);

    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        amount: { type: "number", description: "Invoice total" },
        paid: { type: "boolean" },
      },
      required: ["amount", "paid"],
    });
  });

  it("rejects duplicate field names", () => {
    expect(() =>
      buildExtractionSchema([
        { name: "id", type: "string" },
        { name: "id", type: "string" },
      ]),
    ).toThrow(
      new NonRetriableError('AI Extract node: duplicate field name "id"'),
    );
  });
});

describe("buildOutputSchema", () => {
  const base = {
    variableName: "out",
    model: "openai:gpt-4o",
    content: "{{data.invoice}}",
  } as ExtractData;

  it("prefers a pasted JSON schema over the field list", () => {
    const schema = buildOutputSchema({
      ...base,
      jsonSchema: JSON.stringify({ type: "object", required: ["total"] }),
      fields: [{ name: "amount", type: "number" }],
    });

    expect(schema).toEqual({ type: "object", required: ["total"] });
  });

  it("builds from the field list when no JSON schema is set", () => {
    const schema = buildOutputSchema({
      ...base,
      fields: [{ name: "paid", type: "boolean" }],
    });

    expect(schema.properties).toEqual({ paid: { type: "boolean" } });
    expect(schema.required).toEqual(["paid"]);
  });

  it("treats a whitespace-only JSON schema as unset", () => {
    const schema = buildOutputSchema({
      ...base,
      jsonSchema: "   ",
      fields: [{ name: "paid", type: "boolean" }],
    });

    expect(schema.properties).toEqual({ paid: { type: "boolean" } });
  });

  it("throws when neither source is configured", () => {
    expect(() => buildOutputSchema(base)).toThrow(
      new NonRetriableError(
        "AI Extract node: configure either an extraction schema (JSON) or at least one extraction field",
      ),
    );
  });
});

describe("parseStructuredSchema", () => {
  it("returns the parsed schema for a valid object schema", () => {
    expect(parseStructuredSchema('{"type":"object"}')).toEqual({
      type: "object",
    });
  });

  it("throws a non-retriable error for invalid JSON", () => {
    expect(() => parseStructuredSchema("{ nope")).toThrow(
      new NonRetriableError(
        "AI Extract node: extraction schema is not valid JSON",
      ),
    );
  });

  it("throws for JSON that parses to a non-object value", () => {
    expect(() => parseStructuredSchema("[1, 2]")).toThrow(
      new NonRetriableError(
        "AI Extract node: extraction schema must be a JSON object",
      ),
    );
    expect(() => parseStructuredSchema("42")).toThrow(
      new NonRetriableError(
        "AI Extract node: extraction schema must be a JSON object",
      ),
    );
  });

  it("requires a top-level type of object", () => {
    expect(() => parseStructuredSchema('{"type":"array"}')).toThrow(
      new NonRetriableError(
        'AI Extract node: extraction schema must have "type": "object" at the top level so the model returns a JSON object',
      ),
    );
  });
});
