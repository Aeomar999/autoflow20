import type { NodeDefinition } from "@/nodes/types";
import { aiModelDataSchema } from "../../shared/config-fields";

export const configSchema = aiModelDataSchema();

export const definition: NodeDefinition = {
  type: "ANTHROPIC",
  version: 1,
  category: "AI",
  label: "Anthropic",
  description:
    "Generate text with an Anthropic Claude model. Prompts support templates against upstream results.",
  icon: "BrainCircuit",
  keywords: ["anthropic", "claude", "llm", "text", "ai"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
};
