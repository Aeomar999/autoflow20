import { z } from "zod";
import { UNMATCHED_OUTPUT_PORT } from "@/inngest/trace";
import type { NodeDefinition, PortDef } from "@/nodes/types";

/** Comparison operators shared with CONDITION. */
export const switchOperators = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
] as const;
export type SwitchOperator = (typeof switchOperators)[number];

/**
 * A single SWITCH rule. `outputKey` names the output port this rule routes to;
 * `left`/`right` are Handlebars templates resolved against the context (AF-M9-05
 * enriched view via `resolve`); `operator` defines the comparison.
 */
export const ruleSchema = z.object({
  /** Name of the output port this rule routes to. Must be unique + stable();
   * renaming detaches edges, which `validate()` reports (AF-M9-09). */
  outputKey: z
    .string()
    .min(1)
    .max(64)
    .refine(
      (v) => v !== UNMATCHED_OUTPUT_PORT,
      `"${UNMATCHED_OUTPUT_PORT}" is reserved for the engine's no-match signal`,
    ),
  /** Left-hand side of the comparison (Handlebars template). */
  left: freeText(4096),
  /** Comparison operator. */
  operator: z.enum(switchOperators),
  /** Right-hand side of the comparison (Handlebars template). */
  right: freeText(4096),
});

export const configSchema = z.object({
  /**
   * Ordered rules, first match wins (max 10, AF-M9-09). The ports rendered on
   * the canvas are exactly these `outputKey`s, resolved by `resolveOutputs`.
   */
  rules: z.array(ruleSchema).max(10).optional(),
  /**
   * What to do when no rule matches. `"none"` emits the engine's no-match
   * sentinel so no branch is taken and downstream is SKIPPED (run SUCCESS);
   * `"extra"` routes to the extra port (an implicit final rule).
   */
  fallback: z.enum(["none", "extra"]).optional(),
});

export type SwitchData = z.infer<typeof configSchema>;

function freeText(max: number) {
  return z.string().max(max);
}

export const definition: NodeDefinition = {
  type: "SWITCH",
  version: 1,
  category: "LOGIC",
  label: "Switch",
  description:
    "Route to one of several output branches based on the first matching rule.",
  icon: "GitBranch",
  keywords: ["switch", "route", "multi", "case", "fan-out", "logic"],
  configSchema,
  defaults: { rules: [], fallback: "none" },
  inputs: [{ id: "main", label: "In" }],
  // Outputs are config-dependent: they are exactly the configured rules'
  // outputKeys (plus an "extra" port when fallback is "extra"). Declared
  // empty; `resolveOutputs` is the single source of truth for the port set.
  outputs: [],
  resolveOutputs: (config) => resolveOutputs(config),
};

/**
 * The single port-resolution path for SWITCH (AF-M9-09). Maps each rule to an
 * output port; a non-empty `extra` fallback appends the reserved "extra" port.
 * Runs identically on the server (compile/markTakenEdges) and the client
 * (canvas handle rendering), because both go through `outputPorts("SWITCH",
 * config)` and this function is side-effect free. The no-match sentinel can
 * never appear here — the configSchema forbids it as an outputKey — so the
 * engine's "no branch taken" path is unambiguous.
 */
export function resolveOutputs(config: unknown): PortDef[] {
  const data = (config ?? {}) as SwitchData;
  const rules = data.rules ?? [];
  const ports: PortDef[] = rules.map((r) => ({
    id: r.outputKey,
    label: r.outputKey,
    description: `Route when rule "${r.outputKey}" matches`,
  }));
  if (data.fallback === "extra") {
    ports.push({ id: "extra", label: "Else", description: "No rule matched" });
  }
  return ports;
}
