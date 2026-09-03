import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  compareOperatorSchema,
  compareValueTypeSchema,
} from "../../shared/compare";
import { freeText, variableNameSchema } from "../../shared/config-fields";

/**
 * `FILTER` (AF-M10-10) — keep only what matches.
 *
 * Two shapes, and which one runs is decided by where the node sits, not by a
 * mode field:
 *
 * - **Inside a `SPLIT_OUT`/`AGGREGATE` segment** it tests the current item.
 *   A non-match drops that item: the rest of the chain is skipped for it and
 *   `AGGREGATE` does not collect it. Dropping every item is a legitimate
 *   result, not a failure.
 * - **Outside a segment** it resolves an array and returns the matching
 *   subset.
 *
 * The comparison is typed (AF-M9-08's rule applied to filtering), because
 * `CONDITION`'s string compare makes "keep the ones where ok is true" keep
 * everything: `false` renders as `"false"`, and `"false"` is a non-empty
 * string.
 */
export const configSchema = z.object({
  /** Result key in the run context. Only used outside a fan-out segment. */
  variableName: variableNameSchema.optional(),
  /**
   * Template resolving to a JSON array. Required outside a segment; ignored
   * inside one, where the item comes from the segment.
   */
  items: freeText(4096).optional(),
  /**
   * Dot-path into each array element, used ONLY in array mode — e.g. `status`
   * or `customer.email`. Empty compares the element itself.
   *
   * Array mode needs a path rather than a template because a template is
   * compiled against the *node's* context, which has no per-element scope: the
   * engine only puts `$item` in scope for segment interiors. A path is
   * evaluated per element with no ambiguity about what it addresses.
   */
  itemPath: freeText(512).optional(),
  /**
   * Left-hand expression, used ONLY inside a fan-out segment, where `$item`
   * is in scope — e.g. `{{$item.status}}`.
   */
  left: freeText(4096).optional(),
  operator: compareOperatorSchema.optional(),
  right: freeText(4096).optional(),
  /** How to read both sides. Defaults to string, which is the pre-typed behaviour. */
  valueType: compareValueTypeSchema.optional(),
});

export const definition: NodeDefinition = {
  type: "FILTER",
  version: 1,
  category: "TRANSFORM",
  label: "Filter",
  description:
    "Keep only the items that match a typed condition. Inside a fan-out segment it drops non-matching items; outside one it filters an array.",
  icon: "Filter",
  keywords: ["filter", "where", "keep", "match", "items"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/FILTER",
};
