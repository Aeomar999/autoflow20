import "server-only";

import { NonRetriableError } from "inngest";
import type { EmployeeActiveInput } from "@/features/employees/lib/employee";
import { employeeActiveSchema } from "@/features/employees/lib/employee";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import {
  assertLifecycleContext,
  lifecycleFields,
} from "@/nodes/people/shared/lifecycle-fields";
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
  const scope = assertLifecycleContext(data, organizationId, where);
  const field = lifecycleFields(resolve, where);

  // An unknown start date leaves `activeAt` ABSENT, not "" — the handoff then
  // stamps the transition time itself (AF-M11-14).
  const activeAt = field.optional(data.activeAt);

  const input: EmployeeActiveInput = {
    event: "employee.active",
    employeeRef: field.required(data.employeeRef, "employee reference"),
    ...(activeAt !== undefined ? { activeAt } : {}),
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

    return applyEmployeeHandoff(scope.organizationId, parsed.data);
  });

  return {
    ...context,
    [scope.variableName]: outcome,
  };
};
