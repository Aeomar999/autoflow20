import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeName: z.string().max(256).optional(),
  plan: z
    .enum(["medical", "dental", "vision", "life", "401k"])
    .default("medical"),
  dependentsCount: z.number().int().min(0).max(99).default(0),
  notes: freeText(2000).optional(),
});

export const definition: NodeDefinition = {
  type: "BENEFITS_ENROLLMENT",
  version: 1,
  category: "ACTION",
  label: "Submit Benefits Enrollment",
  description:
    "Submit a new hire's benefits plan selection and expose the enrollment record to downstream nodes.",
  icon: "FileText",
  keywords: [
    "benefits",
    "enrollment",
    "insurance",
    "medical",
    "401k",
    "dental",
    "new hire",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/BENEFITS_ENROLLMENT",
};
