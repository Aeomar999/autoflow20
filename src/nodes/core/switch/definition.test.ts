import { describe, expect, it } from "vitest";
import { UNMATCHED_OUTPUT_PORT } from "@/inngest/trace";
import { configSchema, definition, resolveOutputs } from "./definition";

describe("SWITCH definition", () => {
  it("exports a valid NodeDefinition (AF-M9-09)", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "SWITCH",
        version: 1,
        category: "LOGIC",
        icon: "GitBranch",
      }),
    );
  });

  it("declares no static outputs but resolves them from config (AF-M9-09)", () => {
    expect(definition.outputs).toEqual([]);
    expect(typeof definition.resolveOutputs).toBe("function");
  });

  it("maps each rule to an output port (AF-M9-09)", () => {
    const ports = resolveOutputs({
      rules: [
        { outputKey: "low", left: "{{x}}", operator: "lte", right: "10" },
        { outputKey: "high", left: "{{x}}", operator: "gt", right: "10" },
      ],
      fallback: "none",
    });
    expect(ports.map((p) => p.id)).toEqual(["low", "high"]);
  });

  it("appends the extra port when fallback is 'extra' (AF-M9-09)", () => {
    const ports = resolveOutputs({
      rules: [
        { outputKey: "yes", left: "{{x}}", operator: "equals", right: "true" },
      ],
      fallback: "extra",
    });
    expect(ports.map((p) => p.id)).toEqual(["yes", "extra"]);
  });

  it("does not append extra when fallback is 'none' (AF-M9-09)", () => {
    const ports = resolveOutputs({
      rules: [
        { outputKey: "yes", left: "{{x}}", operator: "equals", right: "true" },
      ],
      fallback: "none",
    });
    expect(ports.map((p) => p.id)).toEqual(["yes"]);
  });

  it("resolves an empty port set for an empty rules list (AF-M9-09)", () => {
    expect(resolveOutputs({ rules: [], fallback: "none" })).toEqual([]);
    expect(resolveOutputs(undefined)).toEqual([]);
  });

  it("accepts up to ten rules (AF-M9-09)", () => {
    const rules = Array.from({ length: 10 }, (_, i) => ({
      outputKey: `r${i}`,
      left: "{{x}}",
      operator: "equals" as const,
      right: String(i),
    }));
    expect(configSchema.safeParse({ rules }).success).toBe(true);
  });

  it("rejects more than ten rules (AF-M9-09)", () => {
    const rules = Array.from({ length: 11 }, (_, i) => ({
      outputKey: `r${i}`,
      left: "{{x}}",
      operator: "equals" as const,
      right: String(i),
    }));
    const result = configSchema.safeParse({ rules });
    expect(result.success).toBe(false);
  });

  it("rejects the reserved no-match sentinel as an outputKey (AF-M9-09)", () => {
    const result = configSchema.safeParse({
      rules: [
        {
          outputKey: UNMATCHED_OUTPUT_PORT,
          left: "x",
          operator: "equals",
          right: "y",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown operator (AF-M9-09)", () => {
    const result = configSchema.safeParse({
      rules: [{ outputKey: "a", left: "x", operator: "xor", right: "y" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty config (AF-M9-09)", () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });
});
