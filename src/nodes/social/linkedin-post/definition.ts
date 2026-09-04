import { z } from "zod";
import {
  LINKEDIN_ACCOUNT_REQUIREMENT,
  LINKEDIN_CREDENTIAL_TYPE,
  LINKEDIN_LOGO,
} from "@/features/social/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  text: freeText(4000).optional(),
  /** Optional image, as a file reference from an earlier node. */
  imageRef: freeText(2048).optional(),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
});

export const definition: NodeDefinition = {
  type: "LINKEDIN_POST",
  version: 1,
  category: "ACTION",
  label: "LinkedIn Post",
  description:
    "Publish a post, with an optional image. The image goes through LinkedIn's register-then-upload flow and is streamed from the run's file store rather than buffered.",
  icon: "Send",
  logo: LINKEDIN_LOGO,
  keywords: ["linkedin", "post", "share", "social", "publish", "ugc"],
  configSchema,
  defaults: { visibility: "PUBLIC" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: LINKEDIN_CREDENTIAL_TYPE, required: true },
  ],
  accountRequirement: LINKEDIN_ACCOUNT_REQUIREMENT,
  docsUrl: "/docs/nodes/LINKEDIN_POST",
};
