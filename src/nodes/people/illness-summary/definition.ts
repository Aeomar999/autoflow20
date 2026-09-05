import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  cacheTtlSecondsSchema,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]+$/)
  .max(120);

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  model: modelIdSchema.optional(),
  fallbackModels: z.string().max(500).optional(),
  openaiCredentialId: z.string().cuid().optional(),
  anthropicCredentialId: z.string().cuid().optional(),
  geminiCredentialId: z.string().cuid().optional(),
  userPrompt: promptSchema().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(16_384).optional(),
  cacheTtlSeconds: cacheTtlSecondsSchema().optional(),
});

export const definition: NodeDefinition = {
  type: "ILLNESS_SUMMARY",
  version: 1,
  category: "AI",
  label: "Summarize Illness",
  description:
    "Condense an employee's illness and sick-leave notes into a concise factual briefing, exposing the summary to downstream nodes.",
  icon: "Sparkles",
  keywords: [
    "summarize",
    "illness",
    "sick leave",
    "employee",
    "absence",
    "notes",
    "briefing",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  supportsResponseCache: true,
  credentials: [
    { key: "openaiCredentialId", type: "openai.apiKey", required: false },
    { key: "anthropicCredentialId", type: "anthropic.apiKey", required: false },
    { key: "geminiCredentialId", type: "gemini.apiKey", required: false },
  ],
  docsUrl: "/docs/nodes/ILLNESS_SUMMARY",
};
