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
  channel: freeText(256).optional(),
  /** Comma-separated Slack user IDs (U0123ABCD), not emails or @names. */
  userIds: freeText(4096).optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK_INVITE",
  version: 1,
  category: "ACTION",
  label: "Slack Invite to Channel",
  description:
    "Invite users to a Slack channel by user ID. Someone already in the channel is not an error, so this is safe to re-run.",
  icon: "UserPlus",
  logo: SLACK_LOGO,
  keywords: ["slack", "invite", "channel", "members", "add"],
  configSchema,
  defaults: {},
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
  docsUrl: "/docs/nodes/SLACK_INVITE",
};
