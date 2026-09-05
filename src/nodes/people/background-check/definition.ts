import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  candidateName: z.string().max(256).optional(),
  candidateEmail: z.string().max(512).optional(),
  checkType: z.enum(["standard", "enhanced", "reference"]).default("standard"),
  notes: freeText(2000).optional(),
});

export const definition: NodeDefinition = {
  type: "BACKGROUND_CHECK",
  version: 1,
  category: "ACTION",
  label: "Request Background Check",
  description:
    "Submit a background check request for a candidate and expose the request reference to downstream nodes.",
  icon: "ShieldCheck",
  keywords: [
    "background",
    "check",
    "vetting",
    "screening",
    "candidate",
    "compliance",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/BACKGROUND_CHECK",
};
