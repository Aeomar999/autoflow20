import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  employeeRef: z.string().max(200).optional(),
  exitDate: z.string().max(128).optional(),
});

export const definition: NodeDefinition = {
  type: "EMPLOYEE_OFFBOARDED",
  version: 1,
  category: "ACTION",
  label: "Complete Offboarding",
  description:
    "Emit the terminal employee.offboarded handoff once the exit checklist is closed — moves the OFFBOARDING employee to OFFBOARDED exactly once. OFFBOARDED is an end state, so a replay is a no-op and an employee who never entered offboarding returns a conflict instead of skipping the phase.",
  icon: "UserRoundX",
  keywords: [
    "employee",
    "offboarded",
    "exit",
    "complete",
    "terminate",
    "handoff",
    "employee.offboarded",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EMPLOYEE_OFFBOARDED",
};
