import "server-only";

import { NonRetriableError } from "inngest";
import type { z } from "zod";
import type { NodeRun } from "@/nodes/types";
import type { checklistItemSchema } from "./definition";

/** The config as AUTHORED — see `candidate-score-rank/execute.ts` (AF-M11-15). */
type ChecklistItem = z.input<typeof checklistItemSchema>;

export type OnboardingChecklistData = {
  variableName?: string;
  roleTitle?: string;
  items?: ChecklistItem[];
};

export const execute: NodeRun<OnboardingChecklistData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Onboarding Checklist node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  const role = resolve(data.roleTitle ?? "").trim();

  const checklist = await step.run("build-onboarding-checklist", async () => ({
    phase: "ONBOARDING",
    role,
    items: (data.items ?? []).map((item) => ({
      key: item.key,
      label: item.label,
      ...(item.owner ? { owner: item.owner } : {}),
      dueOffsetDays: item.dueOffsetDays ?? 0,
      completed: false,
    })),
    generatedAt: new Date().toISOString(),
  }));

  return {
    ...context,
    [variableName]: { checklist },
  };
};
