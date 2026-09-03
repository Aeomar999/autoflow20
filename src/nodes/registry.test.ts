import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeManifest, nodePalette } from "./manifest";
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

  it("keeps deprecated types registered and executable (AF-M5-09)", () => {
    // ADR-0011's rule: deprecation removes a type from the palette, never from
    // the registry. A saved workflow still holding one must keep running, so
    // the type stays resolvable until no row references it and it is deleted
    // outright (AF-M8-12).
    //
    // This used to pin the exact retired set to ["ANTHROPIC","GEMINI","OPENAI"].
    // AF-M8-12 completed their retirement, so that list made a finished
    // lifecycle fail the suite. The rule is what matters, not the population:
    // stated this way the guard is latent today and fires on its own the next
    // time something is deprecated, which is exactly when it is needed.
    for (const definition of nodeManifest.filter((d) => d.deprecated)) {
      expect(nodeRegistry.has(definition.type)).toBe(true);
      expect(typeof nodeRegistry.resolve(definition.type).execute).toBe(
        "function",
      );
    }
  });

  it("offers every non-deprecated type in the palette and no deprecated one", () => {
    const paletteTypes = new Set(nodePalette.map((entry) => entry.type));

    for (const definition of nodeManifest) {
      expect(paletteTypes.has(definition.type)).toBe(!definition.deprecated);
    }
  });

  it("points every deprecation at a replacement that is still offered", () => {
    for (const definition of nodeManifest) {
      if (!definition.deprecated) continue;
      const replacement = nodeManifest.find(
        (entry) => entry.type === definition.deprecated?.replacedBy,
      );
      expect(replacement).toBeDefined();
      expect(replacement?.deprecated).toBeUndefined();
    }
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
    // Discovered from disk rather than listed by hand. The list used to be
    // hardcoded, which broke twice over when AF-M8-12 deleted the retired AI
    // node folders - it named three directories that no longer exist - and,
    // worse, it failed OPEN: adding a node and forgetting to add it here meant
    // the guard silently skipped it, which is the one case this test exists to
    // catch. Walking the tree cannot go stale and cannot miss a new node.
    const root = join(process.cwd(), "src/nodes");
    const executes: string[] = [];

    for (const namespace of readdirSync(root, { withFileTypes: true })) {
      if (!namespace.isDirectory()) continue;
      const namespaceDir = join(root, namespace.name);

      for (const node of readdirSync(namespaceDir, { withFileTypes: true })) {
        if (!node.isDirectory()) continue;
        const executePath = join(namespaceDir, node.name, "execute.ts");
        if (existsSync(executePath)) {
          executes.push(executePath);
        }
      }
    }

    // Guard the guard: a walk that found nothing would pass vacuously.
    expect(executes.length).toBeGreaterThan(10);

    for (const executePath of executes) {
      const source = readFileSync(executePath, "utf8");
      expect(
        source.startsWith('import "server-only";'),
        `${executePath} must start with import "server-only"`,
      ).toBe(true);
    }
  });
});

describe("executor context hygiene (AF-M9-05)", () => {
  /** Every `execute.ts` on disk. Walked, not listed — a hand-list fails open. */
  function findExecuteModules(): string[] {
    const root = join(process.cwd(), "src/nodes");
    const executes: string[] = [];

    for (const namespace of readdirSync(root, { withFileTypes: true })) {
      if (!namespace.isDirectory()) continue;
      const namespaceDir = join(root, namespace.name);

      for (const node of readdirSync(namespaceDir, { withFileTypes: true })) {
        if (!node.isDirectory()) continue;
        const executePath = join(namespaceDir, node.name, "execute.ts");
        if (existsSync(executePath)) executes.push(executePath);
      }
    }
    return executes;
  }

  it("no executor compiles templates itself", () => {
    // This is what makes "an executor cannot return a `$`-prefixed key"
    // enforceable rather than aspirational. `context` no longer carries
    // `$json`/`$node`/`$execution`/`$workflow`/`$now` — the enriched view
    // exists only inside the `resolve` closure the runner passes in. The one
    // way back to it is to import the template module and rebuild it, so
    // that import is the thing to forbid.
    //
    // An executor that did would reintroduce the exact defect AF-M9-05 fixed:
    // executors return `{ ...context, … }`, so the scaffolding would be
    // persisted into nodeOutputs, Execution.output and every NodeExecution,
    // with `$json` self-referencing the context and re-nesting at each hop.
    const executes = findExecuteModules();

    // Guard the guard: a walk that found nothing would pass vacuously.
    expect(executes.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const executePath of executes) {
      const source = readFileSync(executePath, "utf8");
      if (
        source.includes("compileTemplate") ||
        source.includes("buildTemplateContext") ||
        source.includes("makeResolver")
      ) {
        offenders.push(executePath);
      }
    }

    expect(
      offenders,
      `these executors reach for the template module directly; use the injected resolve() instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every executor that resolves templates destructures resolve", () => {
    // Catches the other half: a node that takes `resolve` but never uses it is
    // harmless, while one that templates without it cannot compile — so this
    // asserts the positive case is actually wired, not just that the negative
    // one is absent.
    const withResolveParam = findExecuteModules().filter((p) =>
      readFileSync(p, "utf8").includes("resolve("),
    );
    expect(withResolveParam.length).toBeGreaterThan(10);

    for (const executePath of withResolveParam) {
      const source = readFileSync(executePath, "utf8");
      expect(
        /\n\s+resolve,\n/.test(source),
        `${executePath} calls resolve() but does not destructure it from NodeRunParams`,
      ).toBe(true);
    }
  });
});

describe("reserved config keys (AF-M9-06)", () => {
  it("no node declares the reserved `_run` key as its own config field", () => {
    // `_run` is the per-node run policy, validated separately from the node's
    // configSchema. A node declaring it would give one key two owners and two
    // validation rules.
    for (const def of nodeManifest) {
      const shape =
        (def.configSchema as unknown as { shape?: Record<string, unknown> })
          .shape ?? {};
      expect(
        Object.keys(shape),
        `${def.type} must not declare "_run"`,
      ).not.toContain("_run");
    }
  });

  it("no node declares the legacy underscore keys either", () => {
    for (const def of nodeManifest) {
      const shape =
        (def.configSchema as unknown as { shape?: Record<string, unknown> })
          .shape ?? {};
      const keys = Object.keys(shape);
      expect(keys, `${def.type}`).not.toContain("_timeoutMs");
      expect(keys, `${def.type}`).not.toContain("_continueOnFail");
    }
  });
});
