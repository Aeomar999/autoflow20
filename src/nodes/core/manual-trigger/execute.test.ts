import { describe, expect, it, vi } from "vitest";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("MANUAL_TRIGGER execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("passes context through when no payload is provided", async () => {
    const result = await execute({
      nodeId: "node-1",
      data: {},
      userId: "user-1",
      context: { existing: "value" },
      step,
      publish,
    });

    expect(result).toEqual({ existing: "value" });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("parses valid JSON string payload and injects into trigger context", async () => {
    const payload = JSON.stringify({ email: "user@example.com", count: 42 });
    const result = await execute({
      nodeId: "node-1",
      data: { payload },
      userId: "user-1",
      context: { existing: "value" },
      step,
      publish,
    });

    expect(result).toEqual({
      existing: "value",
      trigger: { email: "user@example.com", count: 42 },
      email: "user@example.com",
      count: 42,
    });
  });

  it("falls back to raw string trigger when payload is not JSON", async () => {
    const payload = "simple-raw-text";
    const result = await execute({
      nodeId: "node-1",
      data: { payload },
      userId: "user-1",
      context: { existing: "value" },
      step,
      publish,
    });

    expect(result).toEqual({
      existing: "value",
      trigger: "simple-raw-text",
    });
  });
});
