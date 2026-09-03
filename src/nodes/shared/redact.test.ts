import { describe, expect, it } from "vitest";
import { REDACTED, redactSecrets } from "./redact";

describe("redactSecrets (AF-M10-01)", () => {
  it("returns the value untouched when there is nothing to redact", () => {
    const value = { a: 1, b: "hello" };
    expect(redactSecrets(value, [])).toBe(value);
  });

  it("scrubs a secret out of nested strings, arrays and keys' values", () => {
    const out = redactSecrets(
      {
        headers: { authorization: "Bearer tok_supersecret" },
        list: ["prefix tok_supersecret suffix", "clean"],
        nested: { deep: { token: "tok_supersecret" } },
      },
      ["tok_supersecret"],
    );

    expect(JSON.stringify(out)).not.toContain("tok_supersecret");
    expect(out.headers.authorization).toBe(`Bearer ${REDACTED}`);
    expect(out.list[0]).toBe(`prefix ${REDACTED} suffix`);
    expect(out.list[1]).toBe("clean");
    expect(out.nested.deep.token).toBe(REDACTED);
  });

  it("leaves object keys alone — a key is a field name, not a value", () => {
    const out = redactSecrets({ tok_supersecret: "value" }, [
      "tok_supersecret",
    ]);
    expect(Object.keys(out)).toEqual(["tok_supersecret"]);
  });

  it("ignores values too short to be a credential", () => {
    // Redacting "ab" would blank half of any English response. A secret that
    // short is not worth protecting, and destroying real data to protect it
    // would be the worse failure.
    const out = redactSecrets({ text: "a table of absolutes" }, ["ab"]);
    expect(out.text).toBe("a table of absolutes");
  });

  it("redacts the longest secret first so overlaps leave no tail", () => {
    const out = redactSecrets({ text: "prefix-secret-suffix" }, [
      "prefix-secret",
      "prefix-secret-suffix",
    ]);
    expect(out.text).toBe(REDACTED);
  });

  it("passes non-plain objects through instead of rebuilding them", () => {
    const when = new Date("2026-09-03T00:00:00.000Z");
    const out = redactSecrets({ when }, ["tok_supersecret"]);
    expect(out.when).toBe(when);
  });

  it("handles null, numbers and booleans without throwing", () => {
    expect(
      redactSecrets({ a: null, b: 42, c: true }, ["tok_supersecret"]),
    ).toEqual({ a: null, b: 42, c: true });
  });
});
