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
  /** Template resolving to a `FileRef` — three braces, `{{{json report.file}}}`. */
  file: freeText(8192).optional(),
  /** Destination folder id. Absent uploads to the account's root. */
  folderId: freeText(256).optional(),
  /** Overrides the stored file's own name. */
  filename: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "DRIVE_UPLOAD",
  version: 1,
  category: "ACTION",
  label: "Drive Upload",
  description: "Upload a file from the workflow into a Drive folder.",
  icon: "Upload",
  logo: "/logos/google-drive.svg",
  keywords: ["google", "drive", "upload", "file", "archive", "store"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: DRIVE_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/DRIVE_UPLOAD",
};
