import { z } from "zod";
import {
  CREATOMATE_CREDENTIAL_TYPE,
  CREATOMATE_LOGO,
  MEDIA_DEFAULT_WAIT_SECONDS,
  MEDIA_MAX_WAIT_SECONDS,
} from "@/features/media/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  templateId: freeText(128).optional(),
  /**
   * JSON object of element name to value. Keys must match the template's own
   * element names exactly.
   */
  modifications: freeText(32_000).optional(),
  maxWaitSeconds: z
    .number()
    .int()
    .min(30)
    .max(MEDIA_MAX_WAIT_SECONDS)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "CREATOMATE_RENDER",
  version: 1,
  category: "ACTION",
  label: "Creatomate Render",
  description:
    "Render a video from a Creatomate template and store the result as a run file. The wait is a durable, cancellable step, and a render nobody is waiting on is asked to stop rather than left billing.",
  icon: "Clapperboard",
  logo: CREATOMATE_LOGO,
  keywords: ["creatomate", "video", "render", "template", "media", "generate"],
  configSchema,
  defaults: { maxWaitSeconds: MEDIA_DEFAULT_WAIT_SECONDS },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: CREATOMATE_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/CREATOMATE_RENDER",
};
