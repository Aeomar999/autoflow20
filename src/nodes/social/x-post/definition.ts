import { z } from "zod";
import {
  X_ACCOUNT_REQUIREMENT,
  X_CREDENTIAL_TYPE,
  X_LOGO,
  X_MAX_POST_CHARS,
} from "@/features/social/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  text: freeText(4000).optional(),
  /** Post id to reply to, for building a thread. */
  replyToId: freeText(64).optional(),
});

export const definition: NodeDefinition = {
  type: "X_POST",
  version: 1,
  category: "ACTION",
  label: "X Post",
  description:
    "Publish a post to X. Length is checked the way X counts it — weighted, so emoji count double — before the call rather than after the rejection.",
  icon: "Send",
  logo: X_LOGO,
  keywords: ["x", "twitter", "post", "tweet", "social", "publish"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: X_CREDENTIAL_TYPE, required: true },
  ],
  accountRequirement: X_ACCOUNT_REQUIREMENT,
  docsUrl: "/docs/nodes/X_POST",
};

export const MAX_CHARS = X_MAX_POST_CHARS;
