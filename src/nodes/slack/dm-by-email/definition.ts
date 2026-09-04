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
  /** Must match the address on the person's Slack profile. */
  email: freeText(320).optional(),
  text: freeText(40_000).optional(),
  blocks: freeText(40_000).optional(),
  /**
   * End the run quietly when nobody in the workspace has that address, rather
   * than failing. For a meeting briefing that runs over a guest list, an
   * external attendee is expected, not an error.
   */
  skipIfNotFound: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "SLACK_DM_BY_EMAIL",
  version: 1,
  category: "ACTION",
  label: "Slack DM by Email",
  description:
    "Look a person up by email and send them a direct message. The address must match their Slack profile, which is often not their work address.",
  icon: "Send",
  logo: SLACK_LOGO,
  keywords: ["slack", "dm", "direct message", "email", "lookup", "user"],
  configSchema,
  defaults: { skipIfNotFound: false },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: SLACK_CREDENTIAL_TYPE,
      required: true,
      scopes: [
        SLACK_SCOPES.usersReadEmail,
        SLACK_SCOPES.imWrite,
        SLACK_SCOPES.chatWrite,
      ],
    },
  ],
  docsUrl: "/docs/nodes/SLACK_DM_BY_EMAIL",
};
