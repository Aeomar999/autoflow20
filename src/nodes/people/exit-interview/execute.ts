import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";

type ExitInterviewData = {
  variableName?: string;
  employeeName?: string;
  departureDate?: string;
  interviewer?: string;
  format?: "video" | "in_person" | "written";
  focusAreas?: { area: string }[];
};

export const execute: NodeRun<ExitInterviewData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Exit Interview node";

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

  const departureDate = resolve(data.departureDate ?? "").trim() || undefined;
  const interviewer = resolve(data.interviewer ?? "").trim() || undefined;
  const format = data.format ?? "video";

  const interview = await step.run("schedule-exit-interview", async () => ({
    employeeName,
    ...(departureDate ? { departureDate } : {}),
    ...(interviewer ? { interviewer } : {}),
    format,
    focusAreas: (data.focusAreas ?? []).map((f) => f.area),
    status: "SCHEDULED",
  }));

  return {
    ...context,
    [variableName]: interview,
  };
};
