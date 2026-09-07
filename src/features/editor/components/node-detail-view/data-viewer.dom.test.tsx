import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataViewer, toTableRows } from "./data-viewer";

describe("toTableRows", () => {
  it("tabulates an array of flat objects", () => {
    expect(toTableRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("wraps a single flat object as one row", () => {
    expect(toTableRows({ a: 1, b: "x" })).toEqual([{ a: 1, b: "x" }]);
  });

  it("refuses a primitive", () => {
    expect(toTableRows("hello")).toBeNull();
    expect(toTableRows(42)).toBeNull();
  });

  it("refuses null and undefined", () => {
    expect(toTableRows(null)).toBeNull();
    expect(toTableRows(undefined)).toBeNull();
  });

  it("refuses an array of primitives", () => {
    expect(toTableRows([1, 2, 3])).toBeNull();
  });

  it("refuses an empty array", () => {
    expect(toTableRows([])).toBeNull();
  });

  it("refuses an empty object", () => {
    expect(toTableRows({})).toBeNull();
  });

  it("refuses an array of empty objects", () => {
    expect(toTableRows([{}])).toBeNull();
    expect(toTableRows([{}, {}])).toBeNull();
  });

  it("tabulates mixed rows where some are empty but at least one has keys", () => {
    expect(toTableRows([{}, { a: 1 }])).toEqual([{}, { a: 1 }]);
  });
});

describe("DataViewer", () => {
  it("defaults to the table view when the value tabulates", () => {
    render(<DataViewer value={[{ name: "Ada" }]} label="Output" />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("switches to JSON and back", () => {
    render(<DataViewer value={[{ name: "Ada" }]} label="Output" />);
    fireEvent.click(screen.getByRole("button", { name: "Output as JSON" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/"name": "Ada"/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Output as table" }));
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("falls back to JSON with no table toggle when the value cannot tabulate", () => {
    render(<DataViewer value="just a string" label="Output" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Output as table" }),
    ).toBeNull();
    expect(screen.getByText(/just a string/)).toBeTruthy();
  });

  it("renders a nested cell as JSON rather than [object Object]", () => {
    render(<DataViewer value={[{ user: { id: 7 } }]} label="Output" />);
    expect(screen.getByText('{"id":7}')).toBeTruthy();
  });

  it("shows an em dash for a missing cell", () => {
    render(<DataViewer value={[{ a: 1 }, { b: 2 }]} label="Output" />);
    // Row 1 has no `b`, row 2 has no `a` - two blanks.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("falls back to JSON with no table toggle when the value is an empty object", () => {
    render(<DataViewer value={{}} label="Output" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Output as table" }),
    ).toBeNull();
    expect(screen.getByText("{}")).toBeTruthy();
  });
});
