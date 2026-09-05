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
  /** JQL, e.g. `project = ENG AND status = "In Progress"`. */
  jql: freeText(4096).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

export const definition: NodeDefinition = {
  type: "JIRA_SEARCH",
  version: 1,
  category: "DATA",
  label: "Jira Search (JQL)",
  description:
    "Run a JQL query and return the matching issues with their status, assignee and labels.",
  icon: "Search",
  logo: JIRA_LOGO,
  keywords: ["jira", "search", "jql", "query", "issues", "filter"],
  configSchema,
  defaults: { limit: 100 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: JIRA_CREDENTIAL_TYPE,
      required: true,
      scopes: [JIRA_SCOPES.readWork],
    },
  ],
  docsUrl: "/docs/nodes/JIRA_SEARCH",
};
