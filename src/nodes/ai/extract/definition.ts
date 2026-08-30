import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Model selector accepts either a bare provider id (resolves to that
 * provider's default) or a `provider:model` pair — the values the M5-06
 * editor picker will offer. Single-token so the config form renders it as a
 * plain input today.
 */
const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]+$/, "Model must be a provider or provider:model id")
  .max(120);

const extractFieldSchema = z.object({
  name: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Field names must start with a letter or underscore",
    )
    .max(64),
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string().max(2000).optional(),
});

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  model: modelIdSchema.optional(),
  openaiCredentialId: credentialIdRef(),
  anthropicCredentialId: credentialIdRef(),
  geminiCredentialId: credentialIdRef(),
  content: promptSchema(),
  // Either `fields` (schema-builder rows) or `jsonSchema` (a pasted JSON
  // schema) defines what the model returns. Both stay optional at the zod
  // layer so `defaults: {}` remains valid in the registry; execute() resolves
  // precedence and enforces that at least one is configured.
  jsonSchema: z.string().max(100_000).optional(),
  fields: z
    .array(extractFieldSchema)
    .min(1, "At least one extraction field is required")
    .optional(),
});

export type ExtractData = z.infer<typeof configSchema>;

export const definition: NodeDefinition = {
  type: "AI_EXTRACT",
  version: 1,
  category: "AI",
  label: "AI Extract",
  description:
    "Extract structured fields from any text using a registered LLM provider. Define the fields you want back and the model returns a clean JSON object — the document-intelligence primitive.",
  icon: "ScanText",
  keywords: [
    "ai",
    "extract",
    "parse",
    "structured",
    "json",
    "document",
    "intelligence",
    "openai",
    "anthropic",
    "gemini",
    "groq",
    "deepseek",
    "ollama",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "openaiCredentialId", type: "openai.apiKey", required: false },
    { key: "anthropicCredentialId", type: "anthropic.apiKey", required: false },
    { key: "geminiCredentialId", type: "gemini.apiKey", required: false },
  ],
};
