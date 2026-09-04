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
  /** Restrict to one repository. Blank searches everything the token sees. */
  repo: freeText(256).optional(),
  /** GitHub search qualifiers, e.g. `is:open review:required`. */
  query: freeText(1024).optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const definition: NodeDefinition = {
  type: "GITHUB_SEARCH_PRS",
  version: 1,
  category: "DATA",
  label: "GitHub Search Pull Requests",
  description:
    "Search pull requests with GitHub's query syntax — stale reviews, unmerged branches, PRs by author. Returns the matches with their review state.",
  icon: "Search",
  logo: GITHUB_LOGO,
  keywords: ["github", "pull request", "search", "review", "stale", "query"],
  configSchema,
  defaults: { state: "open", limit: 100 },
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
  docsUrl: "/docs/nodes/GITHUB_SEARCH_PRS",
};
