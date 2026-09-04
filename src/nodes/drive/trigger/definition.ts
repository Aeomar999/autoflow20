import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";
import { DRIVE_CREDENTIAL_TYPE } from "../shared";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  /** Folder watched. Its id is the last segment of the folder's URL. */
  folderId: freeText(256).optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "DRIVE_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Drive New File",
  description:
    "Start the workflow for each new file in a Drive folder. Files already there when the trigger is activated are not replayed.",
  icon: "FolderOpen",
  logo: "/logos/google-drive.svg",
  keywords: ["google", "drive", "trigger", "folder", "new file", "poll"],
  configSchema,
  defaults: { pollIntervalSeconds: 300 },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: DRIVE_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/DRIVE_TRIGGER",
};
