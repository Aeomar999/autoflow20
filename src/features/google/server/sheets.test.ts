import { describe, expect, it } from "vitest";
import { columnLabel, mapRowsToFields, startRowOf } from "./sheets";

describe("columnLabel (AF-M10-15)", () => {
  it("maps a column index to its A1 label", () => {
    // A sheet with more than 26 columns is entirely ordinary, and an update
    // addresses cells by label.
    expect(columnLabel(0)).toBe("A");
    expect(columnLabel(25)).toBe("Z");
    expect(columnLabel(26)).toBe("AA");
    expect(columnLabel(27)).toBe("AB");
    expect(columnLabel(51)).toBe("AZ");
    expect(columnLabel(52)).toBe("BA");
    expect(columnLabel(701)).toBe("ZZ");
  });
});

describe("startRowOf (AF-M10-15)", () => {
  it("reads the first row a range covers, so rowNumber addresses the sheet", () => {
    expect(startRowOf("Sheet1!A2:D50")).toBe(2);
    expect(startRowOf("A5:C9")).toBe(5);
    // A bare tab name means the whole sheet, which starts at row 1.
    expect(startRowOf("Sheet1")).toBe(1);
    expect(startRowOf("Sheet1!A:D")).toBe(1);
  });
});

describe("mapRowsToFields (AF-M10-15)", () => {
  it("maps data rows onto the header row", () => {
    const { headers, rows } = mapRowsToFields(
      [
        ["Name", "Email", "Status"],
        ["Ada", "ada@example.com", "active"],
        ["Grace", "grace@example.com", "archived"],
      ],
      { hasHeader: true, startRow: 1 },
    );

    expect(headers).toEqual(["Name", "Email", "Status"]);
    expect(rows[0].fields).toEqual({
      Name: "Ada",
      Email: "ada@example.com",
      Status: "active",
    });
    // Row 1 is the header, so the first data row is row 2 — and a write must
    // land there, not on the header.
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(3);
  });

  it("offsets rowNumber by the range's own start", () => {
    const { rows } = mapRowsToFields([["Name"], ["Ada"]], {
      hasHeader: true,
      startRow: 10,
    });
    expect(rows[0].rowNumber).toBe(11);
  });

  it("pads a short row instead of dropping its missing fields", () => {
    // Sheets omits trailing empty cells. A naive zip drops the field, and
    // `{{row.fields.Status}}` then renders as nothing — indistinguishable from
    // "the status is empty", which is how a filter matches the wrong rows.
    const { rows } = mapRowsToFields(
      [
        ["Name", "Email", "Status"],
        ["Ada", "ada@example.com"],
      ],
      { hasHeader: true, startRow: 1 },
    );

    expect(rows[0].fields).toEqual({
      Name: "Ada",
      Email: "ada@example.com",
      Status: "",
    });
    expect("Status" in rows[0].fields).toBe(true);
    expect(rows[0].cells).toEqual(["Ada", "ada@example.com", ""]);
  });

  it("keeps the first of two identical headers", () => {
    // A sheet with two `Email` columns is a mistake; letting the second win
    // silently makes the outcome depend on column order.
    const { rows } = mapRowsToFields(
      [
        ["Email", "Email"],
        ["first@example.com", "second@example.com"],
      ],
      { hasHeader: true, startRow: 1 },
    );
    expect(rows[0].fields.Email).toBe("first@example.com");
  });

  it("names an unnamed header column rather than keying on an empty string", () => {
    const { headers } = mapRowsToFields(
      [
        ["Name", "", "Status"],
        ["Ada", "x", "active"],
      ],
      { hasHeader: true, startRow: 1 },
    );
    expect(headers).toEqual(["Name", "Column2", "Status"]);
  });

  it("falls back to A1 letters when there is no header row", () => {
    const { headers, rows } = mapRowsToFields(
      [
        ["Ada", "ada@example.com"],
        ["Grace", "grace@example.com"],
      ],
      { hasHeader: false, startRow: 1 },
    );
    expect(headers).toEqual(["A", "B"]);
    expect(rows[0].fields).toEqual({ A: "Ada", B: "ada@example.com" });
    // No header means the first row IS data.
    expect(rows[0].rowNumber).toBe(1);
  });

  it("returns nothing for an empty range", () => {
    expect(mapRowsToFields([], { hasHeader: true, startRow: 1 })).toEqual({
      headers: [],
      rows: [],
    });
  });
});
