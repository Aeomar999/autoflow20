import { z } from "zod";
import { POLLINATIONS_LOGO } from "@/features/media/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  freeText,
  promptSchema,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  prompt: promptSchema(),
  width: z.number().int().min(64).max(2048).optional(),
  height: z.number().int().min(64).max(2048).optional(),
  /** Fixing the seed makes a prompt reproduce the same image. */
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  model: freeText(64).optional(),
  filename: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "POLLINATIONS_IMAGE",
  version: 1,
  category: "AI",
  label: "Pollinations Image",
  description:
    "Generate an image with no API key and no cost, and store it as a run file. Free means rate-limited and occasionally slow, so it retries rather than failing on a busy response.",
  icon: "Image",
  logo: POLLINATIONS_LOGO,
  keywords: ["pollinations", "image", "free", "generate", "flux", "ai"],
  configSchema,
  defaults: { width: 1024, height: 1024 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  // No credentials at all: Pollinations is keyless, which is what makes this
  // the one media node a credential-free template can use.
  docsUrl: "/docs/nodes/POLLINATIONS_IMAGE",
};
