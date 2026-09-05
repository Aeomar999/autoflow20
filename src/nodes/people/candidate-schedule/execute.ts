import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";

type CandidateScheduleData = {
  variableName?: string;
  candidateName?: string;
  candidateEmail?: string;
  interviewType?: "recruiter" | "technical" | "panel" | "final";
  bookingUrlTemplate?: string;
};

export const execute: NodeRun<CandidateScheduleData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Candidate Schedule node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!data.candidateEmail?.trim()) {
    throw new NonRetriableError(`${where}: Candidate email is missing`);
  }
  const candidateEmail = resolve(data.candidateEmail).trim();
  if (!candidateEmail) {
    throw new NonRetriableError(
      `${where}: the candidate email expression resolved to nothing.`,
    );
  }

  if (!data.bookingUrlTemplate?.trim()) {
    throw new NonRetriableError(`${where}: Booking URL is missing`);
  }
  const bookingUrl = resolve(data.bookingUrlTemplate).trim();
  if (!bookingUrl) {
    throw new NonRetriableError(
      `${where}: the booking URL expression resolved to nothing.`,
    );
  }

  const candidateName = resolve(data.candidateName ?? "").trim();
  const interviewType = data.interviewType ?? "recruiter";

  const scheduledInterview = await step.run(
    "schedule-candidate-interview",
    async () => ({
      candidateName,
      candidateEmail,
      interviewType,
      bookingUrl,
    }),
  );

  return {
    ...context,
    [variableName]: scheduledInterview,
  };
};
