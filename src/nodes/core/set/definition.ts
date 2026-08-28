import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

/**
 * The set node lets users map or set fields on the context.
 *
 * `mappings` is an array of { key, value } pairs where:
 * - `key` is the dot-path to set (e.g. "user.name", "count")
 * - `value` is a Handlebars template string that resolves against the context
 *
 * Mappings are applied in order; later mappings overwrite earlier ones.
 */
export const configSchema = z.object({
  mappings: z
    .array(
      z.object({
        key: variableNameSchema,
        value: z.string().max(65_536),
      }),
    )
    .max(50),
});

export const definition: NodeDefinition = {
  type: "SET",
  version: 1,
  category: "TRANSFORM",
  label: "Set",
  description: "Map or set fields on the workflow context using expressions.",
  icon: "ArrowRightLeft",
  keywords: ["set", "map", "field", "transform", "assign"],
  configSchema,
  defaults: { mappings: [] },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
