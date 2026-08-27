import type { NodeDefinition } from "@/nodes/types";
import { aiModelDataSchema } from "../../shared/config-fields";

export const configSchema = aiModelDataSchema();

export const definition: NodeDefinition = {
  type: "GEMINI",
  version: 1,
  category: "AI",
  label: "Gemini",
  description:
    "Generate text with a Google Gemini model. Prompts support templates against upstream results.",
  icon: "Sparkle",
  keywords: ["gemini", "google", "llm", "text", "ai"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "gemini.apiKey", required: true }],
};
