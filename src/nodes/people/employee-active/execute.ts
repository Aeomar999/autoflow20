import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeActiveInput } from "@/features/employees/lib/employee";
import { employeeActiveSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import type { NodeRun } from "@/nodes/types";

type EmployeeActiveData = {
  variableName?: string;
  employeeRef?: string;
  activeAt?: string;
};

export const execute: NodeRun<EmployeeActiveData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) => {
  const where = "Mark Employee Active node";

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

  const input: EmployeeActiveInput = {
    event: "employee.active",
    employeeRef: requiredField(data.employeeRef, "employee reference"),
    ...(data.activeAt !== undefined
      ? { activeAt: resolvedField(data.activeAt) }
      : {}),
  };

  const outcome = await step.run("emit-employee-active", async () => {
    const parsed = employeeActiveSchema.safeParse(input);
    if (!parsed.success) {
      throw new NonRetriableError(
        `${where}: the active input is invalid — ${parsed.error.issues
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
