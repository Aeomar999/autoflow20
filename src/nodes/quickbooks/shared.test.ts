import { NonRetriableError } from "inngest";
import { describe, expect, it } from "vitest";
import { parseQboAmount, parseQboLines } from "./shared";

const where = "test";

describe("parseQboLines (AF-M10-16)", () => {
  it("maps a JSON array onto QBO line inputs", () => {
    const lines = parseQboLines(
      JSON.stringify([
        {
          description: "Consulting",
          amount: 1200,
          quantity: 8,
          unitPrice: 150,
        },
      ]),
      where,
    );

    expect(lines).toEqual([
      {
        amount: 1200,
        description: "Consulting",
        quantity: 8,
        unitPrice: 150,
        itemId: undefined,
      },
    ]);
  });

  it("accepts a single object as a one-line document", () => {
    const lines = parseQboLines(JSON.stringify({ amount: 50 }), where);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(50);
  });

  it("accepts QBO's own capitalisation as well as ours", () => {
    // A line coming back from a QBO read and fed into a create is a real
    // shape; rejecting it would force a CODE node to rename four fields.
    const lines = parseQboLines(
      JSON.stringify([{ Amount: 99, Description: "Retainer", Qty: 1 }]),
      where,
    );
    expect(lines[0]).toMatchObject({
      amount: 99,
      description: "Retainer",
      quantity: 1,
    });
  });

  it("coerces a formatted amount from a spreadsheet", () => {
    // `Number("$1,299.00")` is NaN, which QBO rejects with a message about
    // the whole document rather than about this cell.
    const lines = parseQboLines(
      JSON.stringify([{ amount: "$1,299.00" }]),
      where,
    );
    expect(lines[0].amount).toBe(1299);
  });

  it("keeps a negative amount, which is a credit line", () => {
    const lines = parseQboLines(JSON.stringify([{ amount: "-40.50" }]), where);
    expect(lines[0].amount).toBe(-40.5);
  });

  it("names the two-brace mistake, the most likely authoring error", () => {
    // `{{json items}}` HTML-escapes the quotes, so the value arrives as
    // `[{&quot;amount&quot;:1}]`. A bare "Unexpected token" would send the
    // author looking at their data rather than at their braces.
    expect(() => parseQboLines("[{&quot;amount&quot;:1}]", where)).toThrow(
      /three braces/i,
    );
  });

  it("refuses a line with no amount rather than posting a zero", () => {
    expect(() =>
      parseQboLines(JSON.stringify([{ amount: "" }]), where),
    ).toThrow(/line 1 has no amount/i);
  });

  it("names which line is wrong", () => {
    expect(() =>
      parseQboLines(
        JSON.stringify([{ amount: 10 }, { amount: 20 }, { description: "x" }]),
        where,
      ),
    ).toThrow(/line 3/);
  });

  it("refuses an expression that resolved to nothing", () => {
    expect(() => parseQboLines("   ", where)).toThrow(NonRetriableError);
  });
});

describe("parseQboAmount (AF-M10-16)", () => {
  it("reads a plain number", () => {
    expect(parseQboAmount("42.50", where)).toBe(42.5);
  });

  it("strips a currency symbol and separators", () => {
    expect(parseQboAmount("$1,299.00", where)).toBe(1299);
    expect(parseQboAmount("€ 89.99", where)).toBe(89.99);
  });

  it("refuses an empty expression rather than booking a zero", () => {
    // A blank source cell resolves to "", and Number("") is 0 — which would
    // record a real expense of nothing against a real account.
    expect(() => parseQboAmount("", where)).toThrow(/is not an amount/i);
  });

  it("refuses text", () => {
    expect(() => parseQboAmount("to be confirmed", where)).toThrow(
      NonRetriableError,
    );
  });
});
