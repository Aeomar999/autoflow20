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
  /**
   * Transition NAME ("Done", "In Progress"), not a numeric id. Ids are
   * per-project and do not survive being copied between projects.
   */
  transition: freeText(128).optional(),
  /** Optional plain-text comment posted with the transition. */
  comment: freeText(32_000).optional(),
});

export const definition: NodeDefinition = {
  type: "JIRA_TRANSITION",
  version: 1,
  category: "ACTION",
  label: "Jira Transition Issue",
  description:
    "Move an issue to another status by transition name. The name is resolved against the issue's own workflow at run time, so the node keeps working across projects — unlike a hardcoded transition id.",
  icon: "ArrowRightLeft",
  logo: JIRA_LOGO,
  keywords: ["jira", "transition", "status", "workflow", "move", "done"],
  configSchema,
  defaults: {},
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
  docsUrl: "/docs/nodes/JIRA_TRANSITION",
};
