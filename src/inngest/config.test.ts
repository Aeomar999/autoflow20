import { describe, expect, it } from "vitest";
import { ENGINE_RETRIES, MAX_STACK_LENGTH, truncateStack } from "./config";

describe("truncateStack", () => {
  it("returns null for undefined stacks", () => {
    expect(truncateStack(undefined)).toBeNull();
  });

  it("keeps short stacks intact", () => {
    const stack = "Error: boom\n    at foo (bar.ts:1:1)";
    expect(truncateStack(stack)).toBe(stack);
  });

  it("truncates long stacks to MAX_STACK_LENGTH", () => {
    const stack = "x".repeat(MAX_STACK_LENGTH + 100);
    const result = truncateStack(stack);
    expect(result).toHaveLength(MAX_STACK_LENGTH);
  });
});

describe("ENGINE_RETRIES", () => {
  it("defaults to 3 retries in every environment", () => {
    expect(ENGINE_RETRIES).toBe(3);
  });
});
