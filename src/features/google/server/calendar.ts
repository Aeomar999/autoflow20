import "server-only";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";
import { googleFetch, paginate } from "./google-client";

/**
 * Google Calendar reads (AF-M10-15).
 *
 * Only what automation #27 needs: the events starting soon, with their
 * attendees, so a briefing can be assembled and a WAIT can park until fifteen
 * minutes before the meeting.
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  /** RFC 3339 start. All-day events carry a date, not a datetime. */
  start: string;
  end: string;
  allDay: boolean;
  hangoutLink?: string;
  htmlLink?: string;
  organizer?: string;
  /** Attendee emails, which is what #27 looks people up by. */
  attendees: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    optional: boolean;
    self: boolean;
  }>;
}

interface RawEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  hangoutLink?: string;
  htmlLink?: string;
  organizer?: { email?: string };
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    optional?: boolean;
    self?: boolean;
    resource?: boolean;
  }>;
}

export const normalizeEvent = (raw: RawEvent): CalendarEvent => ({
  id: raw.id ?? "",
  summary: raw.summary ?? "(no title)",
  description: raw.description ?? "",
  location: raw.location ?? "",
  start: raw.start?.dateTime ?? raw.start?.date ?? "",
  end: raw.end?.dateTime ?? raw.end?.date ?? "",
  allDay: Boolean(raw.start?.date && !raw.start.dateTime),
  hangoutLink: raw.hangoutLink,
  htmlLink: raw.htmlLink,
  organizer: raw.organizer?.email,
  attendees: (raw.attendees ?? [])
    // Rooms and equipment are attendees to Calendar and not to a human
    // briefing. #27 looks people up by email, and a meeting room has no
    // Slack account to look up.
    .filter((attendee) => attendee.resource !== true && attendee.email)
    .map((attendee) => ({
      email: attendee.email as string,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      optional: attendee.optional === true,
      self: attendee.self === true,
    })),
});

/** Events starting inside a window, soonest first. */
export async function listCalendarEvents(args: {
  secret: CredentialSecret | undefined;
  calendarId: string;
  timeMin: Date;
  timeMax: Date;
  limit: number;
  where: string;
}): Promise<{ events: CalendarEvent[]; truncated: boolean }> {
  const result = await paginate({
    fetchPage: (pageToken) =>
      googleFetch<{ items?: RawEvent[]; nextPageToken?: string }>(args.secret, {
        url: `${serviceEndpoint("google-calendar")}/${encodeURIComponent(args.calendarId)}/events`,
        query: {
          timeMin: args.timeMin.toISOString(),
          timeMax: args.timeMax.toISOString(),
          // Expands recurring events into their occurrences. Without it a
          // weekly standup is one event carrying a recurrence rule, and the
          // trigger fires for a series rather than for a meeting.
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
          pageToken,
        },
        where: args.where,
      }),
    itemsOf: (page) =>
      (page.items ?? [])
        // A cancelled occurrence still appears in the list. Briefing someone
        // about a meeting that was called off is worse than silence.
        .filter((event) => event.status !== "cancelled")
        .map(normalizeEvent),
    nextTokenOf: (page) => page.nextPageToken,
    limit: args.limit,
  });

  return { events: result.items, truncated: result.truncated };
}
