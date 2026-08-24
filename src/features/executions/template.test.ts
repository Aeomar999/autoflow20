import { describe, expect, it } from "vitest";
import { compileTemplate } from "./template";

const context = {
  user: { name: "Ada" },
  nested: { deep: { value: 42 } },
};

describe("compileTemplate — prototype pollution resistance (AF-A-03)", () => {
  it.each([
    "{{constructor.name}}",
    "{{constructor.constructor}}",
    "{{this.constructor.prototype}}",
    "{{__proto__}}",
    "{{user.__proto__}}",
    "{{user.constructor.prototype.polluted}}",
    "{{lookup . \"constructor\"}}",
    "{{user.toString}}",
    "{{user.hasOwnProperty}}",
  ])("denies prototype chain access via %s", (template) => {
    expect(compileTemplate(template)(context)).toBe("");
  });

  it("cannot reach Node globals through the template", () => {
    expect(compileTemplate("{{process.env.SECRET}}")(context)).toBe("");
    expect(compileTemplate("{{globalThis.process}}")(context)).toBe("");
    expect(compileTemplate("{{require}}")(context)).toBe("");
  });

  it("still resolves legitimate own-property paths", () => {
    expect(compileTemplate("Hello {{user.name}}!")(context)).toBe(
      "Hello Ada!",
    );
    expect(compileTemplate("{{nested.deep.value}}")(context)).toBe("42");
  });

  it("json helper emits own properties only and does not throw on proto probes", () => {
    const rendered = compileTemplate("{{json user}}")(context);
    expect(JSON.parse(rendered)).toEqual({ name: "Ada" });
  });

  it("treats a null context as empty rather than crashing or leaking", () => {
    expect(compileTemplate("x={{missing}}")(null as never)).toBe("x=");
  });
});
