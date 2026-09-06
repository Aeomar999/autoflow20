import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeHiredInput } from "@/features/employees/lib/employee";
import { employeeHiredSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import {
  assertLifecycleContext,
  lifecycleFields,
} from "@/nodes/people/shared/lifecycle-fields";
import type { NodeRun } from "@/nodes/types";

type EmployeeHiredData = {
  variableName?: string;
  employeeRef?: string;
  email?: string;
  fullName?: string;
  role?: string;
  department?: string;
  managerEmail?: string;
  personalEmail?: string;
  startDate?: string;
};

export const execute: NodeRun<EmployeeHiredData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) => {
  const where = "Record New Hire node";
  const scope = assertLifecycleContext(data, organizationId, where);
  const field = lifecycleFields(resolve, where);

  // Optional fields whose expressions resolve to nothing are ABSENT, not "" —
  // an ATS payload missing a department or a manager email must not fail the
  // hire (AF-M11-14).
  const department = field.optional(data.department);
  const managerEmail = field.optional(data.managerEmail);
  const personalEmail = field.optional(data.personalEmail);
  const startDate = field.optional(data.startDate);

  const input: EmployeeHiredInput = {
    event: "employee.hired",
    employeeRef: field.required(data.employeeRef, "employee reference"),
    email: field.required(data.email, "candidate email"),
    fullName: field.required(data.fullName, "candidate full name"),
    role: field.required(data.role, "role"),
    ...(department !== undefined ? { department } : {}),
    ...(managerEmail !== undefined ? { managerEmail } : {}),
    ...(personalEmail !== undefined ? { personalEmail } : {}),
    ...(startDate !== undefined ? { startDate } : {}),
  };

  const outcome = await step.run("emit-employee-hired", async () => {
    const parsed = employeeHiredSchema.safeParse(input);
    if (!parsed.success) {
      throw new NonRetriableError(
        `${where}: the hire input is invalid — ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}.`,
      );
    }

    return applyEmployeeHandoff(scope.organizationId, parsed.data);
  });

  return {
    ...context,
    [scope.variableName]: outcome,
  };
};
