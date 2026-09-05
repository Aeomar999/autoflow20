import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";

const llmExecuteMock = vi.fn();

vi.mock("@/nodes/ai/llm/execute", () => ({
  execute: llmExecuteMock,
}));

const { execute } = await import("./execute");

describe("ILLNESS_SUMMARY execute", () => {
  beforeEach(() => {
    llmExecuteMock.mockClear();
  });

  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("delegates to the LLM node with the baked system prompt", async () => {
    llmExecuteMock.mockResolvedValue({ illness: "briefing" });

    const context = {
      employee: { name: "Ada" },
      illness: { notes: "rest and physio for a strained shoulder." },
    };
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "illnessSummary",
          model: "gpt-4o",
          userPrompt: "{{illness.notes}}",
          temperature: 0.4,
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
      variableName: "illnessSummary",
      model: "gpt-4o",
      fallbackModels: undefined,
      userPrompt:
        "rest and physio for a strained shoulder.\n\nYou are an employee-lifecycle analyst. Summarize the employee's illness and sick-leave notes into a concise, factual briefing: stated condition, reported symptoms, expected duration, and any accommodations or return-to-work notes. Do not invent details that are not present.",
      temperature: 0.4,
      maxTokens: undefined,
      jsonMode: false,
      cacheTtlSeconds: undefined,
    });
    expect(call.context).toEqual(context);
    expect(call.resolve).toEqual(expect.any(Function));
    expect(call.step).toEqual(step);
    expect(call.publish).toEqual(publish);
    expect(result).toEqual({ illness: "briefing" });
  });

  it("defaults the temperature to 0.7 and forwards shared fields", async () => {
    llmExecuteMock.mockResolvedValue({ illness: "briefing" });

    const state = withResolve({
      nodeId: "node-1",
      data: {
        variableName: "illnessSummary",
        userPrompt: "migraine, resting at home",
      },
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
          data: { userPrompt: "migraine" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Illness Summary node: Variable name is missing"),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects missing illness notes", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "illnessSummary" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Illness Summary node: Illness notes are missing"),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });

  it("rejects illness notes that resolve to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "illnessSummary", userPrompt: "{{notes}}" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Illness Summary node: the illness notes expression resolved to nothing.",
      ),
    );
    expect(llmExecuteMock).not.toHaveBeenCalled();
  });
});
