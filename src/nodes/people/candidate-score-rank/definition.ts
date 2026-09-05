import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const rubricItemSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  weight: z.number().min(0).max(1),
});

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  candidatesJson: freeText(100_000).optional(),
  rubric: z.array(rubricItemSchema).min(1).max(20).optional(),
});

export const definition: NodeDefinition = {
  type: "CANDIDATE_SCORE_RANK",
  version: 1,
  category: "TRANSFORM",
  label: "Score & Rank Candidates",
  description:
    "Score a list of candidates against a weighted rubric and rank them from best to worst fit.",
  icon: "UserSearch",
  keywords: [
    "score",
    "rank",
    "candidates",
    "rubric",
    "weight",
    "screening",
    "evaluate",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/CANDIDATE_SCORE_RANK",
};
