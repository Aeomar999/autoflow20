import { z } from "zod";
import {
  YOUTUBE_ACCOUNT_REQUIREMENT,
  YOUTUBE_CREDENTIAL_TYPE,
  YOUTUBE_LOGO,
  YOUTUBE_MAX_DESCRIPTION_CHARS,
  YOUTUBE_MAX_TITLE_CHARS,
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
  /** The video, as a file reference from an earlier node. */
  videoRef: freeText(2048).optional(),
  title: freeText(YOUTUBE_MAX_TITLE_CHARS).optional(),
  description: freeText(YOUTUBE_MAX_DESCRIPTION_CHARS).optional(),
  /** Comma-separated. YouTube caps the whole set at 500 characters. */
  tags: freeText(1000).optional(),
  privacyStatus: z.enum(["private", "unlisted", "public"]).optional(),
});

export const definition: NodeDefinition = {
  type: "YOUTUBE_UPLOAD",
  version: 1,
  category: "ACTION",
  label: "YouTube Upload",
  description:
    "Upload a video from the run's file store using YouTube's resumable protocol. The bytes are streamed, so a large video costs a buffer rather than its own size in memory.",
  icon: "Youtube",
  logo: YOUTUBE_LOGO,
  keywords: ["youtube", "upload", "video", "publish", "google", "channel"],
  configSchema,
  defaults: { privacyStatus: "private" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: YOUTUBE_CREDENTIAL_TYPE, required: true },
  ],
  accountRequirement: YOUTUBE_ACCOUNT_REQUIREMENT,
  docsUrl: "/docs/nodes/YOUTUBE_UPLOAD",
};
