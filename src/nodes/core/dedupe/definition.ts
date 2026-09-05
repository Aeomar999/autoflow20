import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

/**
 * `DEDUPE` (AF-M10-10) — skip what this workflow already handled.
 *
 * Four of the reference automations mean "skip what we already processed",
 * which the source templates implement as a sheet lookup per template. Doing
 * that four times is four copies of the same bug surface, so the state lives
 * in `TriggerState` — the same table and the same window the polling framework
 * uses, keyed by `(workflowId, nodeId)`.
 *
 * Like `FILTER`, its shape depends on placement: inside a fan-out segment it
 * drops a repeated item, outside one it filters an array.
 */
export const configSchema = z.object({
  /** Result key in the run context. Only used outside a fan-out segment. */
  variableName: variableNameSchema.optional(),
  /** Template resolving to a JSON array. Required outside a segment. */
  items: freeText(4096).optional(),
  /**
   * What makes an item unique.
   *
   * Inside a segment this is a template — `{{$item.email}}` — because `$item`
   * is in scope there. Outside a segment it is a dot-path into each array
   * element (`email`, `customer.id`), because a template out here would be
   * compiled against the node's context, not the element.
   */
  key: freeText(4096).optional(),
  /**
   * `forever` remembers every key (up to a stated ceiling); `window` remembers
   * the most recent `windowSize`. Use `window` when keys recur legitimately
   * after a while and `forever` when a repeat is always a duplicate.
   */
  mode: z.enum(["forever", "window"]).optional(),
  windowSize: z.number().int().min(1).max(10_000).optional(),
});

export const definition: NodeDefinition = {
  type: "DEDUPE",
  version: 1,
  category: "TRANSFORM",
  label: "Dedupe",
  description:
    "Skip items this workflow has already handled. Remembers keys between runs, scoped to this node.",
  icon: "CopyMinus",
  keywords: ["dedupe", "duplicate", "unique", "seen", "skip", "idempotent"],
  configSchema,
  defaults: { mode: "forever" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/DEDUPE",
};
