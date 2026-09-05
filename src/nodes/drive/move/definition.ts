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
  fileId: freeText(256).optional(),
  /** Folder the file ends up in. Its current parents are removed. */
  toFolderId: freeText(256).optional(),
});

export const definition: NodeDefinition = {
  type: "DRIVE_MOVE",
  version: 1,
  category: "ACTION",
  label: "Drive Move",
  description:
    "Move a file to another folder — how a watched folder stops reprocessing what it has already handled.",
  icon: "FolderInput",
  logo: "/logos/google-drive.svg",
  keywords: ["google", "drive", "move", "folder", "archive", "processed"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: DRIVE_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/DRIVE_MOVE",
};
