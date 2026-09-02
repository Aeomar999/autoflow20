import { describe, expect, it } from "vitest";
import {
  ENGINE_RETRIES,
  MAX_NODE_OUTPUT_BYTES,
  MAX_STACK_LENGTH,
  nodeOutputIsOverLimit,
  serializedBytes,
  truncateStack,
} from "./config";

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

describe("serializedBytes", () => {
  it("measures UTF-8 bytes, not string length", () => {
    // "é" is 2 bytes in UTF-8 but length 1; "🐨" is 4 bytes but length 2.
    // JSON.stringify keeps printable Unicode, so the serialization is 8 bytes.
    expect(serializedBytes("é🐨")).toBe(8);
  });

  it("measures the JSON serialization of the given value", () => {
    expect(serializedBytes({ a: [1, 2], b: "x" })).toBe(
      Buffer.byteLength(JSON.stringify({ a: [1, 2], b: "x" }), "utf-8"),
    );
  });
});

describe("node output size bound (AF-M2-09, ADR-0018)", () => {
  it("treats output under the limit as fine", () => {
    const output = { result: "x".repeat(1_000) };
    expect(serializedBytes(output)).toBeLessThan(MAX_NODE_OUTPUT_BYTES);
    expect(nodeOutputIsOverLimit(serializedBytes(output))).toBe(false);
  });

  it("allows output exactly at the limit", () => {
    // Build a value whose JSON serialization is exactly MAX_NODE_OUTPUT_BYTES.
    // JSON.stringify adds the two surrounding quotes to a bare string.
    const value = "x".repeat(MAX_NODE_OUTPUT_BYTES - 2);
    expect(serializedBytes(value)).toBe(MAX_NODE_OUTPUT_BYTES);
    expect(nodeOutputIsOverLimit(MAX_NODE_OUTPUT_BYTES)).toBe(false);
  });

  it("rejects output over the limit", () => {
    const output = "x".repeat(MAX_NODE_OUTPUT_BYTES + 1);
    expect(serializedBytes(output)).toBeGreaterThan(MAX_NODE_OUTPUT_BYTES);
    expect(nodeOutputIsOverLimit(serializedBytes(output))).toBe(true);
  });
});
