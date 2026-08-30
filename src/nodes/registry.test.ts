import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeManifest } from "./manifest";
import { createNodeRegistry, nodeRegistry } from "./registry";
import type { NodeRegistration } from "./types";

const baseDefinition = {
  type: "test.node",
  version: 1,
  category: "ACTION",
  label: "Test",
  description: "A test node",
  configSchema: { parse: (v: unknown) => v },
  defaults: {},
  inputs: [],
  outputs: [],
} as unknown as NodeRegistration;

const makeRegistration = (
  overrides: Partial<NodeRegistration> = {},
): NodeRegistration => ({
  ...baseDefinition,
  execute: async () => ({}),
  ...overrides,
});

describe("createNodeRegistry", () => {
  it("rejects duplicate type ids", () => {
    expect(() =>
      createNodeRegistry([makeRegistration(), makeRegistration()]),
    ).toThrow(/duplicate node type/i);
  });

  it("rejects a definition without an execute implementation", () => {
    const bad = { ...makeRegistration(), execute: undefined };
    expect(() =>
      createNodeRegistry([bad as unknown as NodeRegistration]),
    ).toThrow(/missing execute/i);
  });

  it("rejects invalid categories", () => {
    expect(() =>
      createNodeRegistry([
        makeRegistration({ category: "WAT" as NodeRegistration["category"] }),
      ]),
    ).toThrow(/invalid category/i);
  });

  it("rejects a missing config schema", () => {
    const bad = makeRegistration();
    delete (bad as unknown as Record<string, unknown>).configSchema;
    expect(() => createNodeRegistry([bad])).toThrow(/configSchema/i);
  });

  it("resolves aliases to their target registration", () => {
    const registry = createNodeRegistry([makeRegistration({ type: "A" })], {
      aliases: { LEGACY_A: "A" },
    });
    expect(registry.resolve("LEGACY_A").type).toBe("A");
    expect(registry.has("LEGACY_A")).toBe(true);
  });

  it("rejects aliases that collide with a registered type", () => {
    expect(() =>
      createNodeRegistry([makeRegistration({ type: "A" })], {
        aliases: { A: "A" },
      }),
    ).toThrow(/collides/i);
  });

  it("names the known types when resolution fails", () => {
    const registry = createNodeRegistry([
      makeRegistration({ type: "known.one" }),
    ]);
    expect(() => registry.resolve("nope")).toThrow(/known\.one/);
  });
});

describe("production node registry + manifest", () => {
  it("registers every manifest entry under its own type id", () => {
    for (const definition of nodeManifest) {
      expect(nodeRegistry.has(definition.type)).toBe(true);
      expect(nodeRegistry.resolve(definition.type)).toMatchObject({
        type: definition.type,
      });
    }
  });

  it("keeps the legacy INITIAL alias resolvable until M1-02 migrates rows", () => {
    expect(nodeRegistry.resolve("INITIAL").type).toBe("MANUAL_TRIGGER");
  });

  it("has definitions whose defaults satisfy their own config schema", () => {
    for (const definition of nodeManifest) {
      expect(() =>
        definition.configSchema.parse(definition.defaults),
      ).not.toThrow();
    }
  });

  it("gives triggers no input ports and actions at least one output", () => {
    for (const definition of nodeManifest) {
      if (definition.category === "TRIGGER") {
        expect(definition.inputs).toHaveLength(0);
      }
      expect(definition.outputs.length).toBeGreaterThan(0);
    }
  });

  // AF-M1-01 acceptance: a test-time assertion proves no execute.ts is
  // reachable from a client entry point. manifest.ts is THE client entry;
  // it must never import execute modules, and every execute module must
  // declare itself server-only so any accidental import fails the build.
  it("never wires implementations into the client-safe manifest", () => {
    const manifestSource = readFileSync(
      join(process.cwd(), "src/nodes/manifest.ts"),
      "utf8",
    );
    expect(manifestSource).not.toMatch(/\/execute"/);
    expect(manifestSource).not.toMatch(/from "\.\/registry"/);
  });

  it('starts every execute module with import "server-only"', () => {
    const folders: Array<[string, string]> = [
      ["core", "manual-trigger"],
      ["forms", "google-form"],
      ["payments", "stripe-trigger"],
      ["http", "request"],
      ["ai", "anthropic"],
      ["ai", "compatible"],
      ["ai", "extract"],
      ["ai", "gemini"],
      ["ai", "llm"],
      ["ai", "openai"],
      ["discord", "send-message"],
      ["slack", "send-message"],
      ["email", "send"],
      ["webhook", "out"],
      ["postgres", "query"],
      ["google-sheets", "append"],
      ["airtable", "create-record"],
      ["hubspot", "create-contact"],
    ];
    for (const [ns, node] of folders) {
      const source = readFileSync(
        join(process.cwd(), "src/nodes", ns, node, "execute.ts"),
        "utf8",
      );
      expect(source.startsWith('import "server-only";')).toBe(true);
    }
  });
});
