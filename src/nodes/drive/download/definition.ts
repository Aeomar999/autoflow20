import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";
import { DRIVE_CREDENTIAL_TYPE } from "../shared";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Drive file id. Usually `{{file.id}}` from a Drive trigger. */
  fileId: freeText(256).optional(),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "DRIVE_DOWNLOAD",
  version: 1,
  category: "DATA",
  label: "Drive Download",
  description:
    "Download a Drive file into file storage. Google Docs, Sheets and Slides are exported to their Office equivalents.",
  icon: "Download",
  logo: "/logos/google-drive.svg",
  keywords: ["google", "drive", "download", "file", "export"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: DRIVE_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/DRIVE_DOWNLOAD",
};
