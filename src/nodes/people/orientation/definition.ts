import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const agendaItemSchema = z.object({
  time: z.string().max(64).optional(),
  topic: z.string().min(1).max(200),
  owner: z.string().max(128).optional(),
});

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  sessionName: z.string().max(256).optional(),
  startDate: z.string().max(128).optional(),
  locationOrMode: z.string().max(256).optional(),
  durationMinutes: z.number().int().min(15).max(480).default(60),
  agendaItems: z.array(agendaItemSchema).max(20).optional(),
});

export const definition: NodeDefinition = {
  type: "ORIENTATION",
  version: 1,
  category: "ACTION",
  label: "Build Orientation Session",
  description:
    "Plan a new-hire orientation session and expose the agenda and logistics to downstream nodes.",
  icon: "UserPlus",
  keywords: [
    "orientation",
    "onboarding",
    "agenda",
    "session",
    "new hire",
    "welcome",
    "training",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/ORIENTATION",
};
