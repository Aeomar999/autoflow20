import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeName: z.string().max(256).optional(),
  departureDate: z.string().max(128).optional(),
  interviewer: z.string().max(128).optional(),
  format: z.enum(["video", "in_person", "written"]).default("video"),
  focusAreas: z
    .array(z.object({ area: z.string().min(1).max(200) }))
    .max(10)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "EXIT_INTERVIEW",
  version: 1,
  category: "ACTION",
  label: "Schedule Exit Interview",
  description:
    "Plan an exit interview for a departing employee and expose the session details to downstream nodes.",
  icon: "MessageSquare",
  keywords: [
    "exit",
    "interview",
    "departure",
    "offboarding",
    "employee",
    "feedback",
    "session",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EXIT_INTERVIEW",
};
