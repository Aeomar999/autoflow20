import { z } from "zod";
import {
  GITHUB_CREDENTIAL_TYPE,
  GITHUB_LOGO,
  GITHUB_SCOPES,
} from "@/features/github/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  repo: freeText(256).optional(),
  /** Branch, tag or SHA. Blank means the default branch. */
  ref: freeText(256).optional(),
  /** ISO-8601. Only commits after this instant. */
  since: freeText(64).optional(),
  path: freeText(512).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const definition: NodeDefinition = {
  type: "GITHUB_LIST_COMMITS",
  version: 1,
  category: "DATA",
  label: "GitHub List Commits",
  description:
    "List commits on a branch, optionally since a timestamp or under a path. Useful for release notes and daily digests.",
  icon: "GitCommit",
  logo: GITHUB_LOGO,
  keywords: ["github", "commits", "history", "log", "changelog", "release"],
  configSchema,
  defaults: { limit: 100 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: GITHUB_CREDENTIAL_TYPE,
      required: true,
      scopes: [GITHUB_SCOPES.repo],
    },
  ],
  docsUrl: "/docs/nodes/GITHUB_LIST_COMMITS",
};
