import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

/**
 * Longest an approval may block a run.
 *
 * Seven days, not thirty like `WAIT`: an approval holds a run open waiting for
 * a person, and a request nobody answered in a week is not going to be
 * answered. The timeout is a decision (route to `rejected`), not an error.
 */
export const MAX_APPROVAL_SECONDS = 7 * 24 * 60 * 60;

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.decision}} */
  variableName: variableNameSchema.optional(),
  /** What the approver is being asked. Supports templates. */
  prompt: freeText(4000).optional(),
  /**
   * Where to send the request. `email` sends through SMTP; `dashboard` posts
   * it to the approvals list only, for teams who live there.
   */
  channel: z.enum(["email", "dashboard"]).optional(),
  /** Recipients for `email`, comma-separated. Supports templates. */
  approvers: freeText(2048).optional(),
  /** SMTP credential for `email`. */
  credentialId: credentialIdRef(),
  from: z.string().email("Invalid from email").optional(),
  subject: freeText(300).optional(),
  /** Seconds to wait before routing to `rejected`. */
  timeoutSeconds: z.number().int().min(60).max(MAX_APPROVAL_SECONDS).optional(),
});

export const definition: NodeDefinition = {
  type: "APPROVAL",
  // Parks on `waitForEvent` until a human answers, which can be days.
  ownsSteps: true,
  version: 1,
  category: "LOGIC",
  label: "Approval",
  description:
    "Ask a person to approve or reject, then continue down the matching branch. The run waits without consuming anything.",
  icon: "ShieldCheck",
  keywords: ["approval", "approve", "reject", "human", "gate", "review"],
  configSchema,
  defaults: { channel: "email", timeoutSeconds: 86_400 },
  inputs: [{ id: "main", label: "In" }],
  // AF-M9-09: static ports, because the branches do not depend on config.
  outputs: [
    { id: "approved", label: "Approved" },
    { id: "rejected", label: "Rejected" },
  ],
  credentials: [{ key: "credentialId", type: "smtp", required: false }],
  docsUrl: "/docs/nodes/APPROVAL",
};
