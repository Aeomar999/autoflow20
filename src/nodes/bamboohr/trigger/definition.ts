import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  /**
   * Only dispatch employees whose department matches. Blank means every
   * department — the common case for a single people team.
   */
  department: freeText(200).optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "BAMBOOHR_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "BambooHR New Employee",
  description:
    "Start a workflow when a person appears in your BambooHR employee directory — the HRIS entry point for the hiring and onboarding chain. Activating never replays the people already there.",
  icon: "UserPlus",
  keywords: [
    "bamboohr",
    "hris",
    "hr",
    "employee",
    "new hire",
    "trigger",
    "poll",
    "directory",
  ],
  configSchema,
  defaults: { pollIntervalSeconds: 900 },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "bamboohr.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/BAMBOOHR_TRIGGER",
};
