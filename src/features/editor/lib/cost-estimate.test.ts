import { describe, expect, it } from "vitest";
import type { EditorNode } from "@/features/editor/store/atoms";
import {
  estimateNodeCost,
  estimateTokens,
  estimateWorkflowCost,
  formatUsdCost,
} from "./cost-estimate";

describe("estimateTokens", () => {
  it("returns 0 for empty or whitespace-only text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("calculates tokens with ~4 chars per token and minimum 1", () => {
    expect(estimateTokens("hi")).toBe(1);
    expect(estimateTokens("1234")).toBe(1);
    expect(estimateTokens("12345")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("formatUsdCost", () => {
  it("formats zero cost as $0.00", () => {
    expect(formatUsdCost(0)).toBe("$0.00");
  });

  it("formats sub-cent amounts with 4 decimals or prefix", () => {
    expect(formatUsdCost(0.00005)).toBe("< $0.0001");
    expect(formatUsdCost(0.0075)).toBe("$0.0075");
    expect(formatUsdCost(0.125)).toBe("$0.125");
  });
});

describe("estimateNodeCost", () => {
  it("returns null for non-AI nodes", () => {
    const node: EditorNode = {
      id: "node-1",
      type: "HTTP_REQUEST",
      data: {},
      position: { x: 0, y: 0 },
    };
    expect(estimateNodeCost(node)).toBeNull();
  });

  it("returns null for ai.retrieve (RAG retrieval node)", () => {
    const node: EditorNode = {
      id: "node-1",
      type: "ai.retrieve",
      data: { query: "search test" },
      position: { x: 0, y: 0 },
    };
    expect(estimateNodeCost(node)).toBeNull();
  });

  it("estimates cost for ai.llm node with default chat output tokens", () => {
    const node: EditorNode = {
      id: "node-llm",
      type: "ai.llm",
      data: {
        model: "openai:gpt-4o",
        systemPrompt: "You are a helpful assistant.",
        userPrompt: "Translate this sentence to French.",
      },
      position: { x: 0, y: 0 },
    };

    const estimate = estimateNodeCost(node);
    expect(estimate).not.toBeNull();
    expect(estimate?.nodeId).toBe("node-llm");
    expect(estimate?.modelId).toBe("openai:gpt-4o");
    // "You are a helpful assistant. Translate this sentence to French." = 63 chars -> ~16 tokens
    expect(estimate?.inputTokens).toBe(16);
    expect(estimate?.outputTokens).toBe(500);
    // gpt-4o pricing: $2.50/1M in, $10/1M out -> (16*2.5 + 500*10)/1e6 = 0.00504
    expect(estimate?.costUsd).toBeCloseTo(0.00504, 5);
  });

  it("respects maxTokens configuration", () => {
    const node: EditorNode = {
      id: "node-llm-max",
      type: "ai.llm",
      data: {
        model: "openai:gpt-4o-mini",
        userPrompt: "Short summary",
        maxTokens: 100,
      },
      position: { x: 0, y: 0 },
    };

    const estimate = estimateNodeCost(node);
    expect(estimate?.outputTokens).toBe(100);
    expect(estimate?.modelId).toBe("openai:gpt-4o-mini");
    // gpt-4o-mini: $0.15/1M in, $0.60/1M out
    expect(estimate?.costUsd).toBeGreaterThan(0);
  });

  it("estimates cost for ai.extract node", () => {
    const node: EditorNode = {
      id: "node-extract",
      type: "ai.extract",
      data: {
        model: "anthropic:claude-3-5-sonnet",
        content: "Invoice total is $500 paid on Jan 1st by ACME.",
        fields: [{ name: "amount", type: "number" }],
      },
      position: { x: 0, y: 0 },
    };

    const estimate = estimateNodeCost(node);
    expect(estimate).not.toBeNull();
    expect(estimate?.modelId).toBe("anthropic:claude-3-5-sonnet");
    expect(estimate?.outputTokens).toBe(256);
    expect(estimate?.costUsd).toBeGreaterThan(0);
  });

  it("estimates zero cost for keyless local models (ollama)", () => {
    const node: EditorNode = {
      id: "node-ollama",
      type: "ai.llm",
      data: {
        model: "ollama:llama3",
        userPrompt: "Hello local model",
      },
      position: { x: 0, y: 0 },
    };

    const estimate = estimateNodeCost(node);
    expect(estimate).not.toBeNull();
    expect(estimate?.costUsd).toBe(0);
  });
});

describe("estimateWorkflowCost", () => {
  it("returns zero metrics when workflow has no AI nodes", () => {
    const nodes: EditorNode[] = [
      { id: "1", type: "MANUAL_TRIGGER", data: {}, position: { x: 0, y: 0 } },
      { id: "2", type: "HTTP_REQUEST", data: {}, position: { x: 0, y: 0 } },
    ];

    const result = estimateWorkflowCost(nodes);
    expect(result.aiNodeCount).toBe(0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.formattedCost).toBe("$0.00");
    expect(result.nodeEstimates).toHaveLength(0);
  });

  it("aggregates cost across multiple AI nodes and ignores disabled nodes", () => {
    const nodes: EditorNode[] = [
      {
        id: "llm-1",
        type: "ai.llm",
        name: "Summarizer",
        data: {
          model: "openai:gpt-4o",
          userPrompt: "Summarize this article",
          maxTokens: 500,
        },
        position: { x: 0, y: 0 },
      },
      {
        id: "extract-1",
        type: "ai.extract",
        name: "Extractor",
        data: {
          model: "anthropic:claude-3-5-haiku",
          content: "Extract data from text",
          fields: [{ name: "item", type: "string" }],
        },
        position: { x: 0, y: 0 },
      },
      {
        id: "disabled-llm",
        type: "ai.llm",
        disabled: true,
        data: {
          model: "openai:gpt-4o",
          userPrompt: "Will not run",
        },
        position: { x: 0, y: 0 },
      },
    ];

    const result = estimateWorkflowCost(nodes);
    expect(result.aiNodeCount).toBe(2);
    expect(result.nodeEstimates).toHaveLength(2);
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(result.nodeEstimates[0].nodeName).toBe("Summarizer");
    expect(result.nodeEstimates[1].nodeName).toBe("Extractor");
  });
});
