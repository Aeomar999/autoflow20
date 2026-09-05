import { describe, expect, it } from "vitest";
import {
  ALLOWED_FORM_FILE_TYPES,
  coerceFieldValue,
  type FormField,
  MAX_FORM_FILE_BYTES,
  parseFormFields,
  parseOptions,
  validateFieldValue,
} from "./form-schema";

const field = (over: Partial<FormField> = {}): FormField => ({
  name: "email",
  label: "Email",
  type: "email",
  ...over,
});

describe("form fields (AF-M10-14)", () => {
  it("parses authored fields, and an empty list from junk", () => {
    expect(
      parseFormFields([{ name: "a", label: "A", type: "text" }]),
    ).toHaveLength(1);
    // A malformed config must not render a half-form; the page 404s instead.
    expect(parseFormFields("not json")).toEqual([]);
    expect(
      parseFormFields([{ name: "1bad", label: "A", type: "text" }]),
    ).toEqual([]);
    expect(parseFormFields([{ name: "a", label: "A", type: "nope" }])).toEqual(
      [],
    );
  });

  it("accepts a fields array that arrived as a JSON string", () => {
    expect(
      parseFormFields(
        JSON.stringify([{ name: "a", label: "A", type: "text" }]),
      ),
    ).toHaveLength(1);
  });

  it("splits select options one per line, ignoring blanks", () => {
    expect(parseOptions("Alpha\n\n  Beta  \nGamma")).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(parseOptions(undefined)).toEqual([]);
  });
});

describe("validateFieldValue (AF-M10-14)", () => {
  it("requires a required field and permits an absent optional one", () => {
    expect(validateFieldValue(field({ required: true }), "")?.message).toMatch(
      /required/,
    );
    expect(validateFieldValue(field(), null)).toBeNull();
    expect(validateFieldValue(field(), "   ")).toBeNull();
  });

  it("accepts ordinary addresses and rejects obvious non-addresses", () => {
    // Deliberately permissive: an intake form that rejects a valid address
    // loses the lead, and the RFC allows more than people expect.
    expect(validateFieldValue(field(), "a.b+tag@sub.example.co.uk")).toBeNull();
    expect(validateFieldValue(field(), "not-an-address")?.message).toMatch(
      /email/,
    );
    expect(
      validateFieldValue(field(), "two @spaces.com")?.message,
    ).toBeTruthy();
  });

  it("rejects a select value that was not offered", () => {
    // A value outside the option set means the request did not come from the
    // rendered form.
    const select = field({
      name: "plan",
      label: "Plan",
      type: "select",
      options: "Starter\nPro",
    });
    expect(validateFieldValue(select, "Pro")).toBeNull();
    expect(validateFieldValue(select, "Enterprise")?.message).toMatch(
      /offered options/,
    );
  });

  it("rejects a number that is not one, and text over its cap", () => {
    expect(
      validateFieldValue(
        field({ name: "n", label: "N", type: "number" }),
        "12",
      ),
    ).toBeNull();
    expect(
      validateFieldValue(field({ name: "n", label: "N", type: "number" }), "x")
        ?.message,
    ).toMatch(/number/);
    expect(
      validateFieldValue(
        field({ name: "t", label: "T", type: "text", maxLength: 3 }),
        "abcd",
      )?.message,
    ).toMatch(/3 characters/);
  });
});

describe("coerceFieldValue (AF-M10-14)", () => {
  it("gives the run context real types, not strings", () => {
    // `{{#if form.fields.subscribe}}` must be false for an unchecked box, and
    // a numeric comparison downstream must not be a string compare.
    expect(
      coerceFieldValue(field({ name: "n", label: "N", type: "number" }), "42"),
    ).toBe(42);
    expect(
      coerceFieldValue(
        field({ name: "c", label: "C", type: "checkbox" }),
        "on",
      ),
    ).toBe(true);
    expect(
      coerceFieldValue(
        field({ name: "c", label: "C", type: "checkbox" }),
        null,
      ),
    ).toBe(false);
    expect(coerceFieldValue(field(), "a@b.com")).toBe("a@b.com");
    expect(coerceFieldValue(field(), null)).toBeNull();
  });
});

describe("public-endpoint limits (AF-M10-14)", () => {
  it("caps a form file well below the platform's own file limit", () => {
    // This endpoint is reachable by anyone with the link, so the ceiling is
    // about what a stranger may push into our storage.
    expect(MAX_FORM_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_FORM_FILE_BYTES).toBeLessThan(100 * 1024 * 1024);
  });

  it("allowlists document and image types only", () => {
    for (const type of ["application/pdf", "image/png", "text/csv"]) {
      expect(ALLOWED_FORM_FILE_TYPES.has(type)).toBe(true);
    }
    // An allowlist, not a blocklist: accepting anything else means hosting
    // arbitrary content for strangers under our domain.
    for (const type of [
      "text/html",
      "application/x-msdownload",
      "image/svg+xml",
      "application/octet-stream",
    ]) {
      expect(ALLOWED_FORM_FILE_TYPES.has(type), type).toBe(false);
    }
  });
});
