import "server-only";

import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time employment",
  part_time: "Part-time employment",
  contract: "Contract engagement",
};

type OfferLetterData = {
  variableName?: string;
  companyName?: string;
  roleTitle?: string;
  candidateName?: string;
  startDate?: string;
  workLocation?: string;
  compensationText?: string;
  employmentType?: "full_time" | "part_time" | "contract";
  extraTerms?: string;
};

export const execute: NodeRun<OfferLetterData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Offer Letter node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  if (!data.companyName?.trim()) {
    throw new NonRetriableError(`${where}: Company name is missing`);
  }
  const companyName = resolve(data.companyName).trim();

  if (!data.roleTitle?.trim()) {
    throw new NonRetriableError(`${where}: Role title is missing`);
  }
  const roleTitle = resolve(data.roleTitle).trim();

  if (!data.candidateName?.trim()) {
    throw new NonRetriableError(`${where}: Candidate name is missing`);
  }
  const candidateName = resolve(data.candidateName).trim();

  if (!data.startDate?.trim()) {
    throw new NonRetriableError(`${where}: Start date is missing`);
  }
  const startDate = resolve(data.startDate).trim();

  if (!data.workLocation?.trim()) {
    throw new NonRetriableError(`${where}: Work location is missing`);
  }
  const workLocation = resolve(data.workLocation).trim();

  if (!data.compensationText?.trim()) {
    throw new NonRetriableError(`${where}: Compensation is missing`);
  }
  const compensationText = resolve(data.compensationText).trim();

  const employmentType = data.employmentType ?? "full_time";
  const employmentLabel = EMPLOYMENT_TYPE_LABEL[employmentType];
  const extraTerms = resolve(data.extraTerms ?? "").trim();
  const generatedAt = new Date().toISOString();

  const letter = await step.run("generate-offer-letter", async () => {
    const baseLetter = `Dear ${candidateName},

We are pleased to offer you the position of ${roleTitle} at ${companyName}, starting on ${startDate}.

This is a ${employmentLabel.toLowerCase()} position based in ${workLocation}. As part of this offer, your compensation package is as follows:

${compensationText}

This offer is contingent upon the successful completion of any applicable background and reference checks. This is a draft offer and is not yet approved for signature; it must be reviewed and approved by the People Team before you sign.

${
  extraTerms ? `Additional terms:\n\n${extraTerms}\n` : ""
}We look forward to welcoming you to ${companyName}.

Best regards,
People Team`;

    return baseLetter;
  });

  return {
    ...context,
    [variableName]: {
      candidateName,
      roleTitle,
      companyName,
      startDate,
      workLocation,
      employmentType,
      compensationText,
      letter,
      generatedAt,
    },
  };
};
