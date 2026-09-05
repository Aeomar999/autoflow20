import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  companyName: z.string().max(256).optional(),
  roleTitle: z.string().max(256).optional(),
  candidateName: z.string().max(256).optional(),
  startDate: z.string().max(128).optional(),
  workLocation: z.string().max(256).optional(),
  compensationText: z.string().max(1024).optional(),
  employmentType: z
    .enum(["full_time", "part_time", "contract"])
    .default("full_time"),
  extraTerms: freeText(4000).optional(),
});

export const definition: NodeDefinition = {
  type: "OFFER_LETTER",
  version: 1,
  category: "ACTION",
  label: "Draft Offer Letter",
  description:
    "Draft a candidate offer letter from template fields and expose the letter text to downstream nodes.",
  icon: "FileText",
  keywords: [
    "offer",
    "letter",
    "candidate",
    "compensation",
    "draft",
    "hiring",
    "document",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/OFFER_LETTER",
};
