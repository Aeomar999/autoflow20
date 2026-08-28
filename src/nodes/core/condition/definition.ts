import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText } from "../../shared/config-fields";

/**
 * Condition node: evaluates an expression and routes to "true" or "false".
 *
 * `left` and `right` are Handlebars template strings resolved against the
 * context. `operator` defines the comparison. The node returns `_outputPort`
 * set to "true" or "false" so the engine marks the corresponding edge as
 * taken (AF-M2-04 branch-taken semantics).
 */
export const configSchema = z.object({
  /** Left-hand side of the comparison (Handlebars template). */
  left: freeText(4096).optional(),
  /** Comparison operator. */
  operator: z
    .enum([
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
    ])
    .optional(),
  /** Right-hand side of the comparison (Handlebars template). */
  right: freeText(4096).optional(),
});

export type ConditionData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "CONDITION",
  version: 1,
  category: "LOGIC",
  label: "Condition",
  description: "Evaluate a condition and route to true or false branches.",
  icon: "GitBranch",
  keywords: ["condition", "if", "branch", "route", "filter"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [
    { id: "true", label: "True" },
    { id: "false", label: "False" },
  ],
};
