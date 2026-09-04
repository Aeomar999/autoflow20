import "server-only";
import { listCalendarEvents } from "@/features/google/server/calendar";
import type { PollingTrigger } from "@/nodes/types";

type CalendarTriggerConfig = {
  calendarId?: string;
  lookaheadMinutes?: number;
};

/**
 * `CALENDAR_TRIGGER`'s poller (AF-M10-15 on the AF-M10-05 framework).
 *
 * The window moves with the clock, so the same event comes back on every poll
 * until it passes. That is not a problem to solve here — the framework's id
 * window is what makes it fire once — and it is why the item id carries the
 * start time: a rescheduled meeting SHOULD brief again, and keying on the
 * event id alone would treat the new slot as already handled.
 */
export const polling: PollingTrigger<CalendarTriggerConfig> = {
  defaultIntervalSeconds: 300,

  async poll({ config, credentials, limit }) {
    const lookaheadMinutes = config.lookaheadMinutes ?? 120;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + lookaheadMinutes * 60_000);

    const { events } = await listCalendarEvents({
      secret: credentials?.credentialId,
      calendarId: config.calendarId?.trim() || "primary",
      timeMin: now,
      timeMax: windowEnd,
      limit,
      where: "Calendar trigger",
    });

    return {
      items: events.map((event) => ({
        id: `${event.id}@${event.start}`,
        data: { event },
      })),
      // Informational: the window is derived from the clock on every poll, so
      // there is nothing to resume from.
      cursor: { lastWindowEnd: windowEnd.toISOString() },
    };
  },
};
