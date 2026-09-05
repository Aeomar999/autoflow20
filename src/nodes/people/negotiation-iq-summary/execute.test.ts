import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";

const llmExecuteMock = vi.fn();

vi.mock("@/nodes/ai/llm/execute", () => ({
  execute: llmExecuteMock,
}));

const { execute } = await import("./execute");

describe("NEGOTIATION_IQ_SUMMARY execute", () => {
  beforeEach(() => {
    llmExecuteMock.mockClear();
  });

  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("delegates to the LLM node with the baked system prompt", async () => {
    llmExecuteMock.mockResolvedValue({ negotiation: "briefing" });

    const context = {
      candidate: { name: "Ada" },
      negotiation: { notes: "wants 150k base, needs to close by June." },
    };
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "negotiationIq",
          model: "gpt-4o",
          userPrompt: "{{negotiation.notes}}",
          temperature: 0.3,
        },
        userId: "user-1",
        context,
        step,
        publish,
      }),
    );

    expect(llmExecuteMock).toHaveBeenCalledTimes(1);
    const call = llmExecuteMock.mock.calls[0][0];
    expect(call.data).toEqual({
      variableName: "negotiationIq",
      model: "gpt-4o",
      fallbackModels: undefined,
      userPrompt:
        "wants 150k base, needs to close by June.\n\nYou are a negotiation analyst. From the candidate's notes, summarize their compensation expectations, willingness to flex on non-compensation priorities, leverage points, and any deal-breakers. Be factual and concise; do not invent details that are not present.",
      temperature: 0.3,
      maxTokens: undefined,
      jsonMode: false,
      cacheTtlSeconds: undefined,
    });
    expect(call.context).toEqual(context);
    expect(call.resolve).toEqual(expect.any(Function));
    expect(call.step).toEqual(step);
    expect(call.publish).toEqual(publish);
    expect(result).toEqual({ negotiation: "briefing" });
  });

  it("defaults the temperature to 0.7 and forwards shared fields", async () => {
    llmExecuteMock.mockResolvedValue({ negotiation: "briefing" });

    const state = withResolve({
      nodeId: "node-1",
      data: { variableName: "negotiationIq", userPrompt: "full-time only" },
      userId: "user-1",
      context: {},
      step,
      publish,
    });

    await execute(state);

    const call = llmExecuteMock.mock.calls[0][0];
    expect(call.data.temperature).toBe(0.7);
    expect(call.data.jsonMode).toBe(false);
    expect(call.data.attachments).toBeUndefined();
    expect(call.data.jsonSchema).toBeUndefined();
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { userPrompt: "wants 150k base" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Negotiation IQ Summary node: Variable name is missing",
      ),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects missing negotiation notes", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "negotiationIq" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Negotiation IQ Summary node: Negotiation notes are missing",
      ),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects negotiation notes that resolve to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "negotiationIq", userPrompt: "{{notes}}" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Negotiation IQ Summary node: the negotiation notes expression resolved to nothing.",
      ),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });
});
