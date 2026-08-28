import type { NodeDefinition } from "@/nodes/types";
import { triggerDataSchema } from "../../shared/config-fields";

/**
 * Schedule trigger stub (pending M4). When invoked, passes through
 * the context unchanged. Full cron/schedule receiver lands with M4.
 */
export const configSchema = triggerDataSchema;

export const definition: NodeDefinition = {
  type: "SCHEDULE_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Schedule Trigger",
  description:
    "Start the workflow on a schedule (cron). (Stub — full implementation in M4.)",
  icon: "Clock",
  keywords: ["schedule", "cron", "timer", "trigger", "periodic"],
  configSchema,
  defaults: {},
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
