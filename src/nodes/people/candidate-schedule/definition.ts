import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { urlTemplate, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  candidateName: z.string().max(256).optional(),
  candidateEmail: z.string().max(512).optional(),
  interviewType: z
    .enum(["recruiter", "technical", "panel", "final"])
    .default("recruiter"),
  bookingUrlTemplate: urlTemplate(4096).optional(),
});

export const definition: NodeDefinition = {
  type: "CANDIDATE_SCHEDULE",
  version: 1,
  category: "ACTION",
  label: "Schedule Candidate",
  description:
    "Request an interview slot for a candidate from the recruiting calendar and expose the booking link to downstream nodes.",
  icon: "CalendarClock",
  keywords: [
    "schedule",
    "candidate",
    "interview",
    "booking",
    "calendar",
    "recruiting",
  ],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/CANDIDATE_SCHEDULE",
};
