import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeOffboardedInput } from "@/features/employees/lib/employee";
import { employeeOffboardedSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import {
  assertLifecycleContext,
  lifecycleFields,
} from "@/nodes/people/shared/lifecycle-fields";
import type { NodeRun } from "@/nodes/types";

type EmployeeOffboardedData = {
  variableName?: string;
  employeeRef?: string;
  exitDate?: string;
};

export const execute: NodeRun<EmployeeOffboardedData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) => {
  const where = "Complete Offboarding node";
  const scope = assertLifecycleContext(data, organizationId, where);
  const field = lifecycleFields(resolve, where);

  // An optional field whose expression resolves to nothing is ABSENT,
  // not "" — the contract's date schema rejects the empty string.
  const exitDate = field.optional(data.exitDate);

  const input: EmployeeOffboardedInput = {
    event: "employee.offboarded",
    employeeRef: field.required(data.employeeRef, "employee reference"),
    ...(exitDate !== undefined ? { exitDate } : {}),
  };

  const outcome = await step.run("emit-employee-offboarded", async () => {
    const parsed = employeeOffboardedSchema.safeParse(input);
    if (!parsed.success) {
      throw new NonRetriableError(
        `${where}: the offboarded input is invalid — ${parsed.error.issues
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
