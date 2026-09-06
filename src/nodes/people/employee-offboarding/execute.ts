import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeOffboardingInput } from "@/features/employees/lib/employee";
import { employeeOffboardingSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import {
  assertLifecycleContext,
  lifecycleFields,
} from "@/nodes/people/shared/lifecycle-fields";
import type { NodeRun } from "@/nodes/types";

type EmployeeOffboardingData = {
  variableName?: string;
  employeeRef?: string;
  exitDate?: string;
  exitReason?: string;
};

export const execute: NodeRun<EmployeeOffboardingData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) => {
  const where = "Start Offboarding node";
  const scope = assertLifecycleContext(data, organizationId, where);
  const field = lifecycleFields(resolve, where);

  // An optional field whose expression resolves to nothing is ABSENT,
  // not "" — the contract's date schema rejects the empty string.
  const exitDate = field.optional(data.exitDate);
  const exitReason = field.optional(data.exitReason);

  const input: EmployeeOffboardingInput = {
    event: "employee.offboarding",
    employeeRef: field.required(data.employeeRef, "employee reference"),
    ...(exitDate !== undefined ? { exitDate } : {}),
    ...(exitReason !== undefined ? { exitReason } : {}),
  };

  const outcome = await step.run("emit-employee-offboarding", async () => {
    const parsed = employeeOffboardingSchema.safeParse(input);
    if (!parsed.success) {
      throw new NonRetriableError(
        `${where}: the offboarding input is invalid — ${parsed.error.issues
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
