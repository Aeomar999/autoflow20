import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeHiredInput } from "@/features/employees/lib/employee";
import { employeeHiredSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
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

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!organizationId) {
    throw new NonRetriableError(
      `${where}: the run has no organizationId; it cannot scope the employee write.`,
    );
  }

  const resolvedField = (value: string | undefined) =>
    value === undefined ? undefined : resolve(value).trim();
  const requiredField = (value: string | undefined, label: string) => {
    const field = resolvedField(value);
    if (!field) {
      throw new NonRetriableError(
        `${where}: the ${label} expression resolved to nothing.`,
      );
    }
    return field;
  };

  const input: EmployeeHiredInput = {
    event: "employee.hired",
    employeeRef: requiredField(data.employeeRef, "employee reference"),
    email: requiredField(data.email, "candidate email"),
    fullName: requiredField(data.fullName, "candidate full name"),
    role: requiredField(data.role, "role"),
    ...(data.department !== undefined
      ? { department: resolvedField(data.department) }
      : {}),
    ...(data.managerEmail !== undefined
      ? { managerEmail: resolvedField(data.managerEmail) }
      : {}),
    ...(data.personalEmail !== undefined
      ? { personalEmail: resolvedField(data.personalEmail) }
      : {}),
    ...(data.startDate !== undefined
      ? { startDate: resolvedField(data.startDate) }
      : {}),
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

    return applyEmployeeHandoff(organizationId, parsed.data);
  });

  return {
    ...context,
    [variableName]: outcome,
  };
};
