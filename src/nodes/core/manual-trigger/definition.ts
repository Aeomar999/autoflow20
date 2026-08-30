import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Manual trigger configuration: supports an optional mock JSON payload
 * for testing and manual execution (AF-M4-05).
 */
export const configSchema = z.object({
  payload: z.string().optional(),
});

export const definition: NodeDefinition = {
  type: "MANUAL_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Manual Trigger",
  description: "Start the workflow by clicking Run, with optional input data.",
  icon: "MousePointer",
  keywords: ["manual", "run", "start", "trigger"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
