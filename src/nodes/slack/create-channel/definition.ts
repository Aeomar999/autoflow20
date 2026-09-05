import { z } from "zod";
import {
  SLACK_CREDENTIAL_TYPE,
  SLACK_LOGO,
  SLACK_SCOPES,
} from "@/features/slack/scopes";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Normalised to Slack's rules before the call: lowercase, no spaces. */
  name: freeText(80).optional(),
  isPrivate: z.boolean().optional(),
  /** Channel purpose, shown in the header. */
  purpose: freeText(250).optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK_CREATE_CHANNEL",
  version: 1,
  category: "ACTION",
  label: "Slack Create Channel",
  description:
    "Create a Slack channel. Names are normalised to Slack's rules first, and a name that already exists returns the existing channel rather than failing.",
  icon: "FolderPlus",
  logo: SLACK_LOGO,
  keywords: ["slack", "channel", "create", "conversations"],
  configSchema,
  defaults: { isPrivate: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: SLACK_CREDENTIAL_TYPE,
      required: true,
      scopes: [SLACK_SCOPES.channelsManage],
    },
  ],
  docsUrl: "/docs/nodes/SLACK_CREATE_CHANNEL",
};
