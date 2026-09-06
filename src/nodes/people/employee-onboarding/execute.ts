import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeOnboardingInput } from "@/features/employees/lib/employee";
import { employeeOnboardingSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import type { NodeRun } from "@/nodes/types";

type EmployeeOnboardingData = {
  variableName?: string;
  employeeRef?: string;
};

export const execute: NodeRun<EmployeeOnboardingData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) => {
  const where = "Start Onboarding node";

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

  const input: EmployeeOnboardingInput = {
    event: "employee.onboarding",
    employeeRef: requiredField(data.employeeRef, "employee reference"),
  };

  const outcome = await step.run("emit-employee-onboarding", async () => {
    const parsed = employeeOnboardingSchema.safeParse(input);
    if (!parsed.success) {
      throw new NonRetriableError(
        `${where}: the onboarding input is invalid — ${parsed.error.issues
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
