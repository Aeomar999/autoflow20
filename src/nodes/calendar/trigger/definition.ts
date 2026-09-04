import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

/** Scoped Calendar type, or the deprecated one during its overlap (ADR-0023). */
export const CALENDAR_CREDENTIAL_TYPE = "google.calendar|google.oauth2";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  /** Calendar id. `primary` is the connected account's own calendar. */
  calendarId: freeText(320).optional(),
  /**
   * How far ahead to look. The trigger fires when an event ENTERS this window,
   * so a two-hour window followed by a Wait node is how automation #27 wakes
   * fifteen minutes before a meeting rather than when it was first scheduled.
   */
  lookaheadMinutes: z.number().int().min(5).max(10_080).optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "CALENDAR_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Calendar Upcoming Event",
  description:
    "Start the workflow when an event enters the lookahead window, with its attendees.",
  icon: "CalendarClock",
  logo: "/logos/google-calendar.svg",
  keywords: ["google", "calendar", "trigger", "meeting", "event", "upcoming"],
  configSchema,
  defaults: {
    calendarId: "primary",
    lookaheadMinutes: 120,
    pollIntervalSeconds: 300,
  },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: CALENDAR_CREDENTIAL_TYPE, required: true },
  ],
  docsUrl: "/docs/nodes/CALENDAR_TRIGGER",
};
