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
  /** owner/repo, or a pasted github.com URL. */
  repo: freeText(256).optional(),
  title: freeText(512).optional(),
  /** Branch the changes are on. */
  head: freeText(256).optional(),
  /** Branch to merge into. Defaults to the repo default branch when blank. */
  base: freeText(256).optional(),
  body: freeText(60_000).optional(),
  draft: z.boolean().optional(),
});

export const definition: NodeDefinition = {
  type: "GITHUB_CREATE_PR",
  version: 1,
  category: "ACTION",
  label: "GitHub Create Pull Request",
  description:
    "Open a pull request. An existing open PR for the same branches is returned rather than failing, so this is safe to re-run.",
  icon: "GitPullRequest",
  logo: GITHUB_LOGO,
  keywords: ["github", "pull request", "pr", "create", "branch", "merge"],
  configSchema,
  defaults: { draft: false },
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
  docsUrl: "/docs/nodes/GITHUB_CREATE_PR",
};
