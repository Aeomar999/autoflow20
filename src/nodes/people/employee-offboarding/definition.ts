import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeRef: z.string().max(200).optional(),
  exitDate: z.string().max(128).optional(),
  exitReason: z.string().max(500).optional(),
});

export const definition: NodeDefinition = {
  type: "EMPLOYEE_OFFBOARDING",
  version: 1,
  category: "ACTION",
  label: "Start Offboarding",
  description:
    "Emit the employee.offboarding handoff when an exit is requested — moves the ACTIVE employee to OFFBOARDING once, recording the exit date and reason, and is a no-op on replay so a re-run never double-transitions the record.",
  icon: "UserMinus",
  keywords: [
    "employee",
    "offboarding",
    "exit",
    "leaver",
    "resignation",
    "handoff",
    "employee.offboarding",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EMPLOYEE_OFFBOARDING",
};
