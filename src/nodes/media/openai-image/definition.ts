import { z } from "zod";
import {
  OPENAI_CREDENTIAL_TYPE,
  OPENAI_IMAGE_MODELS,
  OPENAI_IMAGE_SIZES,
  OPENAI_LOGO,
} from "@/features/media/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  prompt: promptSchema(),
  model: z.enum(OPENAI_IMAGE_MODELS).optional(),
  size: z.enum(OPENAI_IMAGE_SIZES).optional(),
  quality: z.enum(["standard", "hd", "low", "medium", "high"]).optional(),
  filename: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "OPENAI_IMAGE",
  version: 1,
  category: "AI",
  label: "OpenAI Image",
  description:
    "Generate an image and store it as a run file other nodes can attach, upload or publish. Cost is recorded per image in the run trace.",
  icon: "Image",
  logo: OPENAI_LOGO,
  keywords: ["openai", "image", "dalle", "generate", "picture", "ai"],
  configSchema,
  defaults: { model: "gpt-image-1", size: "1024x1024" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: OPENAI_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/OPENAI_IMAGE",
};
