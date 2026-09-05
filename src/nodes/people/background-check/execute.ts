import "server-only";

import { randomUUID } from "node:crypto";
import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";

type BackgroundCheckData = {
  variableName?: string;
  candidateName?: string;
  candidateEmail?: string;
  checkType?: "standard" | "enhanced" | "reference";
  notes?: string;
};

export const execute: NodeRun<BackgroundCheckData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Background Check node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!data.candidateName?.trim()) {
    throw new NonRetriableError(`${where}: Candidate name is missing`);
  }
  const candidateName = resolve(data.candidateName).trim();
  if (!candidateName) {
    throw new NonRetriableError(
      `${where}: the candidate name expression resolved to nothing.`,
    );
  }

  if (!data.candidateEmail?.trim()) {
    throw new NonRetriableError(`${where}: Candidate email is missing`);
  }
  const candidateEmail = resolve(data.candidateEmail).trim();
  if (!candidateEmail) {
    throw new NonRetriableError(
      `${where}: the candidate email expression resolved to nothing.`,
    );
  }

  const checkType = data.checkType ?? "standard";
  const notes = data.notes?.trim() || undefined;

  const request = await step.run("request-background-check", async () => ({
    candidateName,
    candidateEmail,
    checkType,
    ...(notes ? { notes } : {}),
    status: "REQUESTED",
    requestId: randomUUID(),
  }));

  return {
    ...context,
    [variableName]: request,
  };
};
