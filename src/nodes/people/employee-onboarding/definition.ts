import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeRef: z.string().max(200).optional(),
});

export const definition: NodeDefinition = {
  type: "EMPLOYEE_ONBOARDING",
  version: 1,
  category: "ACTION",
  label: "Start Onboarding",
  description:
    "Emit the employee.onboarding handoff — moves the OFFERED hire to ONBOARDING once and is a no-op on replay, so a re-run never double-transitions the record.",
  icon: "UserCheck",
  keywords: [
    "employee",
    "onboarding",
    "start",
    "handoff",
    "employee.onboarding",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EMPLOYEE_ONBOARDING",
};
