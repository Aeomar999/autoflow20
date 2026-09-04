import { z } from "zod";
import {
  JIRA_CREDENTIAL_TYPE,
  JIRA_LOGO,
  JIRA_SCOPES,
} from "@/features/jira/constants";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  /** Project key, e.g. `ENG`. */
  projectKey: freeText(64).optional(),
  /** Issue type NAME, e.g. `Task` or `Bug`. Resolved per project. */
  issueType: freeText(64).optional(),
  summary: freeText(255).optional(),
  /** Plain text. Converted to Atlassian Document Format before sending. */
  description: freeText(32_000).optional(),
  /** Comma-separated label names. */
  labels: freeText(1024).optional(),
  priority: freeText(64).optional(),
  /** Atlassian account id, not an email or username. */
  assigneeAccountId: freeText(128).optional(),
});

export const definition: NodeDefinition = {
  type: "JIRA_CREATE_ISSUE",
  version: 1,
  category: "ACTION",
  label: "Jira Create Issue",
  description:
    "Create a Jira issue. The issue type is resolved by name against the project, and the description is converted to Atlassian Document Format, which the v3 API requires.",
  icon: "SquarePlus",
  logo: JIRA_LOGO,
  keywords: ["jira", "issue", "ticket", "create", "task", "bug", "atlassian"],
  configSchema,
  defaults: { issueType: "Task" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: JIRA_CREDENTIAL_TYPE,
      required: true,
      scopes: [JIRA_SCOPES.writeWork, JIRA_SCOPES.readWork],
    },
  ],
  docsUrl: "/docs/nodes/JIRA_CREATE_ISSUE",
};
