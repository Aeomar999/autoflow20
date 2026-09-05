import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";

type BenefitsEnrollmentData = {
  variableName?: string;
  employeeName?: string;
  plan?: "medical" | "dental" | "vision" | "life" | "401k";
  dependentsCount?: number;
  notes?: string;
};

export const execute: NodeRun<BenefitsEnrollmentData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Benefits Enrollment node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!data.employeeName?.trim()) {
    throw new NonRetriableError(`${where}: Employee name is missing`);
  }
  const employeeName = resolve(data.employeeName).trim();
  if (!employeeName) {
    throw new NonRetriableError(
      `${where}: the employee name expression resolved to nothing.`,
    );
  }

  const plan = data.plan ?? "medical";
  const dependentsCount = data.dependentsCount ?? 0;
  const notes = data.notes?.trim() || undefined;

  const enrollment = await step.run("submit-benefits-enrollment", async () => ({
    employeeName,
    plan,
    dependentsCount,
    ...(notes ? { notes } : {}),
    status: "SUBMITTED",
  }));

  return {
    ...context,
    [variableName]: enrollment,
  };
};
