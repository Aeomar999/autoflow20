import { z } from "zod";
import {
  UPLOAD_POST_ACCOUNT_REQUIREMENT,
  UPLOAD_POST_CREDENTIAL_TYPE,
  UPLOAD_POST_LOGO,
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
  /** The profile name created in the Upload-Post dashboard. */
  profile: freeText(128).optional(),
  /** Comma-separated: instagram, tiktok, facebook, linkedin, x, threads. */
  platforms: freeText(256).optional(),
  caption: freeText(4000).optional(),
  /** The media, as a file reference from an earlier node. */
  mediaRef: freeText(2048).optional(),
  isVideo: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "UPLOAD_POST_PUBLISH",
  version: 1,
  category: "ACTION",
  label: "Upload-Post Publish",
  description:
    "Publish media to Instagram and other platforms through Upload-Post. Per-platform results are reported individually, so a partial failure is not read as success.",
  icon: "Share2",
  logo: UPLOAD_POST_LOGO,
  keywords: ["instagram", "upload-post", "publish", "social", "reel", "tiktok"],
  configSchema,
  defaults: { platforms: "instagram", isVideo: true },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: UPLOAD_POST_CREDENTIAL_TYPE, required: true },
  ],
  accountRequirement: UPLOAD_POST_ACCOUNT_REQUIREMENT,
  docsUrl: "/docs/nodes/UPLOAD_POST_PUBLISH",
};
