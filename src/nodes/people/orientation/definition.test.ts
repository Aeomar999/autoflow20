import { describe, expect, it } from "vitest";
import { configSchema, definition } from "./definition";

describe("ORIENTATION definition", () => {
  it("exports a valid NodeDefinition", () => {
    expect(definition).toEqual(
      expect.objectContaining({
        type: "ORIENTATION",
        version: 1,
        category: "ACTION",
      }),
    );
  });

  it("accepts an empty config and defaults the duration to 60 minutes", () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.durationMinutes).toBe(60);
  });

  it("accepts a valid agenda item", () => {
    const result = configSchema.safeParse({
      sessionName: "New Hire Orientation",
      agendaItems: [
        {
          time: "09:30",
          topic: "Welcome & introductions",
          owner: "People Team",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an agenda item with a blank topic", () => {
    const result = configSchema.safeParse({
      agendaItems: [{ topic: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a duration below the minimum", () => {
    const result = configSchema.safeParse({ durationMinutes: 5 });
    expect(result.success).toBe(false);
  });
});
