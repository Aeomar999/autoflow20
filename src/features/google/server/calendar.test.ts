import { describe, expect, it } from "vitest";
import { normalizeEvent } from "./calendar";

describe("normalizeEvent (AF-M10-15)", () => {
  it("keeps the attendee emails a briefing looks people up by", () => {
    const event = normalizeEvent({
      id: "e1",
      summary: "Quarterly review",
      start: { dateTime: "2026-09-04T09:00:00Z" },
      end: { dateTime: "2026-09-04T10:00:00Z" },
      attendees: [
        {
          email: "ada@acme.com",
          displayName: "Ada",
          responseStatus: "accepted",
        },
        { email: "grace@acme.com", optional: true },
      ],
    });

    expect(event.attendees.map((a) => a.email)).toEqual([
      "ada@acme.com",
      "grace@acme.com",
    ]);
    expect(event.attendees[0].responseStatus).toBe("accepted");
    expect(event.attendees[1].optional).toBe(true);
    expect(event.allDay).toBe(false);
  });

  it("drops rooms and equipment from the attendee list", () => {
    // Calendar treats a meeting room as an attendee. #27 looks people up by
    // email, and a room has no Slack account to DM.
    const event = normalizeEvent({
      id: "e2",
      attendees: [
        { email: "ada@acme.com" },
        { email: "room-3@resource.calendar.google.com", resource: true },
      ],
    });
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees[0].email).toBe("ada@acme.com");
  });

  it("marks an all-day event, which carries a date and no time", () => {
    const event = normalizeEvent({
      id: "e3",
      start: { date: "2026-09-04" },
      end: { date: "2026-09-05" },
    });
    expect(event.allDay).toBe(true);
    expect(event.start).toBe("2026-09-04");
  });

  it("gives an untitled event a readable name", () => {
    // "" in a Slack briefing reads as a rendering bug.
    expect(normalizeEvent({ id: "e4" }).summary).toBe("(no title)");
  });

  it("survives an event with no attendees at all", () => {
    const event = normalizeEvent({ id: "e5", summary: "Focus time" });
    expect(event.attendees).toEqual([]);
    expect(event.description).toBe("");
  });
});
