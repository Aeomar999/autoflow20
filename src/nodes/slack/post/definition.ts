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
  /** Channel ID (C0123ABCD) or #name. An ID is stable across renames. */
  channel: freeText(256).optional(),
  text: freeText(40_000).optional(),
  /**
   * Block Kit JSON array. When set, `text` becomes the notification fallback
   * shown in the sidebar and on push — Slack still requires it.
   */
  blocks: freeText(40_000).optional(),
  /** Reply into an existing thread rather than the channel. */
  threadTs: freeText(64).optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK_POST",
  version: 1,
  category: "ACTION",
  label: "Slack Post Message",
  description:
    "Post a message to any Slack channel using the connected workspace. Supports Block Kit and threaded replies. Unlike an incoming webhook, the channel is chosen per run.",
  icon: "MessageSquare",
  logo: SLACK_LOGO,
  keywords: ["slack", "post", "message", "channel", "notify", "blocks"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: SLACK_CREDENTIAL_TYPE,
      required: true,
      scopes: [SLACK_SCOPES.chatWrite, SLACK_SCOPES.chatWritePublic],
    },
  ],
  docsUrl: "/docs/nodes/SLACK_POST",
};
