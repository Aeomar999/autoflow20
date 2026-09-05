import { z } from "zod";
import {
  TELEGRAM_CREDENTIAL_TYPE,
  TELEGRAM_LOGO,
} from "@/features/telegram/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Usually `{{telegram.fileId}}` from the trigger. */
  fileId: freeText(512).optional(),
  /** Overrides the stored name. */
  fileName: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "TELEGRAM_GET_FILE",
  version: 1,
  category: "ACTION",
  label: "Telegram Get File",
  description:
    "Download a document, photo or voice note someone sent the bot and store it as a run file other nodes can attach or upload.",
  icon: "Download",
  logo: TELEGRAM_LOGO,
  keywords: ["telegram", "file", "download", "document", "photo", "attachment"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: TELEGRAM_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/TELEGRAM_GET_FILE",
};
