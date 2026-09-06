import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeRef: z.string().max(200).optional(),
  activeAt: z.string().max(128).optional(),
});

export const definition: NodeDefinition = {
  type: "EMPLOYEE_ACTIVE",
  version: 1,
  category: "ACTION",
  label: "Mark Employee Active",
  description:
    "Emit the employee.active handoff as onboarding wraps up — moves the ONBOARDING (or OFFERED) employee to ACTIVE once and is a no-op on replay, so a re-run never double-transitions the record.",
  icon: "BadgeCheck",
  keywords: [
    "employee",
    "active",
    "activate",
    "handoff",
    "employee.active",
    "completed",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EMPLOYEE_ACTIVE",
};
