import { z } from "zod";
import {
  MEDIA_DEFAULT_WAIT_SECONDS,
  MEDIA_MAX_WAIT_SECONDS,
  VEO_CREDENTIAL_TYPE,
  VEO_LOGO,
  VEO_MAX_SECONDS,
  VEO_MIN_SECONDS,
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
  model: freeText(64).optional(),
  durationSeconds: z
    .number()
    .int()
    .min(VEO_MIN_SECONDS)
    .max(VEO_MAX_SECONDS)
    .optional(),
  aspectRatio: z.enum(["16:9", "9:16"]).optional(),
  maxWaitSeconds: z
    .number()
    .int()
    .min(30)
    .max(MEDIA_MAX_WAIT_SECONDS)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "VEO_GENERATE",
  version: 1,
  category: "AI",
  label: "Veo Generate Video",
  description:
    "Generate a short video with Google Veo on Vertex AI and store it as a run file. Generation takes minutes, so the wait is a durable, cancellable step rather than a held worker.",
  icon: "Video",
  logo: VEO_LOGO,
  keywords: ["veo", "video", "generate", "google", "vertex", "ai"],
  configSchema,
  defaults: {
    model: "veo-3.0-generate-001",
    durationSeconds: 8,
    aspectRatio: "16:9",
    maxWaitSeconds: MEDIA_DEFAULT_WAIT_SECONDS,
  },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: VEO_CREDENTIAL_TYPE, required: true },
  ],
  accountRequirement:
    "Veo runs on Vertex AI, which needs the Vertex AI API enabled on a Google Cloud project with billing, the account granted the Vertex AI User role, and Veo access allowlisted for the project. None of those are things the connect flow can grant, and each surfaces as a 403.",
  docsUrl: "/docs/nodes/VEO_GENERATE",
};
