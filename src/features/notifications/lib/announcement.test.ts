import { describe, expect, it } from "vitest";
import { parseAnnouncementArgs } from "./announcement";

const REQUIRED = [
  "--id",
  "maint-2026-09-14",
  "--title",
  "Scheduled maintenance",
  "--message",
  "Runs may be delayed between 02:00 and 03:00 UTC.",
];

describe("parseAnnouncementArgs", () => {
  it("reads the three required flags", () => {
    expect(parseAnnouncementArgs(REQUIRED)).toEqual({
      id: "maint-2026-09-14",
      title: "Scheduled maintenance",
      message: "Runs may be delayed between 02:00 and 03:00 UTC.",
      href: null,
      confirmed: false,
    });
  });

  it("is a dry run unless --yes is given", () => {
    expect(parseAnnouncementArgs(REQUIRED).confirmed).toBe(false);
    expect(parseAnnouncementArgs([...REQUIRED, "--yes"]).confirmed).toBe(true);
  });

  it("accepts --yes before the value flags", () => {
    expect(parseAnnouncementArgs(["--yes", ...REQUIRED]).confirmed).toBe(true);
  });

  it("carries an optional --href", () => {
    expect(parseAnnouncementArgs([...REQUIRED, "--href", "/status"]).href).toBe(
      "/status",
    );
  });

  it("treats a blank --href as none rather than an empty link", () => {
    expect(
      parseAnnouncementArgs([...REQUIRED, "--href", "  "]).href,
    ).toBeNull();
  });

  it("trims surrounding whitespace from every value", () => {
    const args = parseAnnouncementArgs([
      "--id",
      " maint-1 ",
      "--title",
      "  Title  ",
      "--message",
      "  Body  ",
    ]);

    expect(args).toMatchObject({
      id: "maint-1",
      title: "Title",
      message: "Body",
    });
  });

  it.each(["--id", "--title", "--message"])("requires %s", (flag) => {
    const without = [...REQUIRED];
    const at = without.indexOf(flag);
    without.splice(at, 2);

    expect(() => parseAnnouncementArgs(without)).toThrow(/Missing required/);
  });

  it("rejects a required flag whose value is only whitespace", () => {
    expect(() =>
      parseAnnouncementArgs(["--id", "m1", "--title", "   ", "--message", "x"]),
    ).toThrow(/Missing required/);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    // The point of strictness: `--confirm` must not be read as "not --yes".
    expect(() => parseAnnouncementArgs([...REQUIRED, "--confirm"])).toThrow(
      /Unknown flag/,
    );
  });

  it("rejects a bare positional argument", () => {
    expect(() => parseAnnouncementArgs([...REQUIRED, "send"])).toThrow(
      /Unexpected argument/,
    );
  });

  it("never lets a missing value swallow the next flag", () => {
    // `--title --yes` would otherwise title the broadcast "--yes" AND leave it
    // a dry run, which reads as success and sends nothing.
    expect(() =>
      parseAnnouncementArgs([
        "--id",
        "m1",
        "--title",
        "--yes",
        "--message",
        "x",
      ]),
    ).toThrow(/--title needs a value/);
  });

  it("rejects an id that would corrupt the dedupe key", () => {
    // `:` is the key's own separator; a space makes a key nobody can retype.
    for (const id of ["maint 14", "maint:14", "-leading", "maint/14"]) {
      expect(() =>
        parseAnnouncementArgs(["--id", id, "--title", "t", "--message", "m"]),
      ).toThrow(/--id must be alphanumeric/);
    }
  });

  it("accepts the id shape the support runbook documents", () => {
    for (const id of ["maint-2026-09-14", "incident_42", "v2.deprecation"]) {
      expect(
        parseAnnouncementArgs(["--id", id, "--title", "t", "--message", "m"])
          .id,
      ).toBe(id);
    }
  });
});
