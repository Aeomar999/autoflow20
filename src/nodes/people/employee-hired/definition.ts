import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeRef: z.string().max(200).optional(),
  email: z.string().max(512).optional(),
  fullName: z.string().max(300).optional(),
  role: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  managerEmail: z.string().max(512).optional(),
  personalEmail: z.string().max(512).optional(),
  startDate: z.string().max(128).optional(),
});

export const definition: NodeDefinition = {
  type: "EMPLOYEE_HIRED",
  version: 1,
  category: "ACTION",
  label: "Record New Hire",
  description:
    "Emit the employee.hired handoff for a signed candidate — creates the org Employee row as OFFERED the first time and is a no-op on replay, so a re-run never duplicates the hire.",
  icon: "UserPlus",
  keywords: [
    "employee",
    "hire",
    "hired",
    "offer",
    "handoff",
    "employee.hired",
    "onboarding",
    "trigger",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EMPLOYEE_HIRED",
};
