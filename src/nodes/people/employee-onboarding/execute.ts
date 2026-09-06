import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeOnboardingInput } from "@/features/employees/lib/employee";
import { employeeOnboardingSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import {
  assertLifecycleContext,
  lifecycleFields,
} from "@/nodes/people/shared/lifecycle-fields";
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
  const scope = assertLifecycleContext(data, organizationId, where);
  const field = lifecycleFields(resolve, where);

  const input: EmployeeOnboardingInput = {
    event: "employee.onboarding",
    employeeRef: field.required(data.employeeRef, "employee reference"),
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

    return applyEmployeeHandoff(scope.organizationId, parsed.data);
  });

  return {
    ...context,
    [scope.variableName]: outcome,
  };
};
