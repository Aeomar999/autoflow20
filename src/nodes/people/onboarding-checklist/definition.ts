import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const checklistItemSchema = z.object({
  key: variableNameSchema,
  label: z.string().min(1).max(200),
  owner: z.string().max(128).optional(),
  dueOffsetDays: z.number().int().min(0).max(180).default(0),
});

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  roleTitle: z.string().max(128).optional(),
  items: z.array(checklistItemSchema).min(1).max(30).optional(),
});

export const definition: NodeDefinition = {
  type: "ONBOARDING_CHECKLIST",
  version: 1,
  category: "TRANSFORM",
  label: "Build Onboarding Checklist",
  description:
    "Build a role-aware onboarding checklist and expose the structured task list to downstream nodes.",
  icon: "ClipboardList",
  keywords: [
    "onboarding",
    "checklist",
    "tasks",
    "new hire",
    "employee",
    "joining",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/ONBOARDING_CHECKLIST",
};
