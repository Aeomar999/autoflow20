import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

export const configSchema = z.object({
  cron: z.string().default("0 * * * *"), // Hourly
  timezone: z.string().default("UTC"),
});

export const definition: NodeDefinition = {
  type: "SCHEDULE_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Schedule Trigger",
  description: "Start the workflow on a schedule (cron).",
  icon: "Clock",
  keywords: ["schedule", "cron", "timer", "trigger", "periodic"],
  configSchema,
  defaults: {
    cron: "0 * * * *",
    timezone: "UTC",
  },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
};
