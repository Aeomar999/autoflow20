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
  /** Exact channel name to look for. Sets `found` without scanning downstream. */
  nameFilter: freeText(256).optional(),
  includePrivate: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK_LIST_CHANNELS",
  version: 1,
  category: "DATA",
  label: "Slack List Channels",
  description:
    "List the workspace's channels, optionally looking for one by name. Pair with Create Channel to make a create-if-absent flow.",
  icon: "List",
  logo: SLACK_LOGO,
  keywords: ["slack", "channels", "list", "search", "conversations"],
  configSchema,
  defaults: { includePrivate: false, includeArchived: false, limit: 200 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: SLACK_CREDENTIAL_TYPE,
      required: true,
      scopes: [SLACK_SCOPES.channelsRead, SLACK_SCOPES.groupsRead],
    },
  ],
  docsUrl: "/docs/nodes/SLACK_LIST_CHANNELS",
};
