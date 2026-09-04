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
  issueKey: freeText(64).optional(),
  /** Reference to a file produced earlier in the run. */
  fileRef: freeText(2048).optional(),
  /** Overrides the stored file name. */
  fileName: freeText(255).optional(),
});

export const definition: NodeDefinition = {
  type: "JIRA_ADD_ATTACHMENT",
  version: 1,
  category: "ACTION",
  label: "Jira Add Attachment",
  description:
    "Attach a file produced earlier in the run — a PDF, an export, a screenshot — to a Jira issue.",
  icon: "Paperclip",
  logo: JIRA_LOGO,
  keywords: ["jira", "attachment", "file", "upload", "attach", "pdf"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    {
      key: "credentialId",
      type: JIRA_CREDENTIAL_TYPE,
      required: true,
      scopes: [JIRA_SCOPES.writeWork],
    },
  ],
  docsUrl: "/docs/nodes/JIRA_ADD_ATTACHMENT",
};
