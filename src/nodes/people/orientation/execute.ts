import "server-only";

import { NonRetriableError } from "inngest";
import type { z } from "zod";
import type { NodeRun } from "@/nodes/types";
import type { agendaItemSchema } from "./definition";

type AgendaItem = z.infer<typeof agendaItemSchema>;

type OrientationData = {
  variableName?: string;
  sessionName?: string;
  startDate?: string;
  locationOrMode?: string;
  durationMinutes?: number;
  agendaItems?: AgendaItem[];
};

export const execute: NodeRun<OrientationData> = async ({
  data,
  context,
  resolve,
  step,
}) => {
  const where = "Orientation node";

  if (!data.variableName?.trim()) {
    throw new NonRetriableError(`${where}: Variable name is missing`);
  }
  const variableName = data.variableName;

  const sessionName = resolve(data.sessionName ?? "").trim();
  const startDate = resolve(data.startDate ?? "").trim() || undefined;
  const locationOrMode = resolve(data.locationOrMode ?? "").trim() || undefined;

  const orientation = await step.run("build-orientation-session", async () => ({
    sessionName,
    ...(startDate ? { startDate } : {}),
    ...(locationOrMode ? { locationOrMode } : {}),
    durationMinutes: data.durationMinutes ?? 60,
    agenda: (data.agendaItems ?? []).map((item) => ({
      ...(item.time ? { time: item.time } : {}),
      topic: item.topic,
      ...(item.owner ? { owner: item.owner } : {}),
    })),
  }));

  return {
    ...context,
    [variableName]: { orientation },
  };
};
