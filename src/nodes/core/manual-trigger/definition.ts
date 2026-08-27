import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

/**
 * Transitional type id: the raw Prisma enum value. M1-02 migrates persisted
 * ids to "core.manual-trigger" (and folds the legacy INITIAL alias away).
 */
export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "MANUAL_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Manual Trigger",
  description: "Start the workflow by clicking Run, with optional input data.",
  icon: "MousePointer",
  keywords: ["manual", "run", "start", "trigger"],
  configSchema,
  // z.object({}).optional() parses {} to {}; the engine seeds context itself.
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
