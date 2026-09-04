import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The client/server boundary of the node catalogue, enforced statically.
 *
 * **Why this exists.** `src/nodes/manifest.ts` imports every node's
 * `definition.ts`, and the manifest is imported by `node-selector.tsx`, which
 * is part of the editor — a client component. So everything transitively
 * reachable from a `definition.ts` is bundled for the browser.
 *
 * A value import of `inngest` in `src/nodes/quickbooks/shared.ts` shipped and
 * broke the production build: `inngest`'s entry point reaches
 * `node:async_hooks`, which webpack cannot bundle for the browser, and the
 * deploy failed with `UnhandledSchemeError`. **`tsc`, Biome and 1537 passing
 * tests all stayed green**, because none of them model this boundary — the
 * only thing that catches it is `next build`, which is the slowest feedback
 * loop in the repo and runs last.
 *
 * The file that broke it carried a comment saying it must not do the thing it
 * did. A comment is not an enforcement mechanism; this is.
 *
 * Type-only imports are fine (`import type { ... } from "inngest"` in
 * `types.ts` is erased at compile time and reaches no bundle), so the check
 * distinguishes them rather than banning the module name outright.
 */

const NODES_ROOT = path.join(process.cwd(), "src", "nodes");
const SRC_ROOT = path.join(process.cwd(), "src");

/**
 * Packages that cannot be bundled for the browser.
 *
 * `server-only` is the explicit marker and throws by design. `inngest` is here
 * because its entry point pulls `node:async_hooks` — it is the one that
 * actually broke, and executors legitimately use it, so the rule is about
 * *reachability from a definition*, not about the import existing.
 */
const SERVER_ONLY_MODULES = ["server-only", "inngest", "@/lib/db"];

/** A `node:` builtin is unbundlable for the browser whatever the package. */
const NODE_BUILTIN = /^node:/;

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Read a file's imports.
 *
 * Deliberately a regex rather than a parser: these are all first-party files
 * with `biome format` applied, the shapes are uniform, and a test that needs
 * its own TypeScript program to run is a test people delete.
 */
function importsOf(file: string): ImportRef[] {
  const source = readFileSync(file, "utf-8");
  const refs: ImportRef[] = [];

  // `import ... from "x"`, `import "x"`, and `export ... from "x"`.
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([\s\S]*?)?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const bareSpecifier = match[4];
    if (bareSpecifier) {
      // A side-effect import — `import "server-only"` — is never type-only.
      refs.push({ specifier: bareSpecifier, typeOnly: false });
      continue;
    }

    const specifier = match[3];
    if (!specifier) continue;

    const isTypeKeyword = Boolean(match[1]);
    const clause = match[2] ?? "";
    // `import { type A, type B } from "x"` erases entirely; a mixed clause
    // does not, so every named binding must carry `type`.
    const bindings = clause.match(/\{([\s\S]*)\}/)?.[1];
    const allBindingsTyped = bindings
      ? bindings
          .split(",")
          .map((binding) => binding.trim())
          .filter((binding) => binding.length > 0)
          .every((binding) => binding.startsWith("type "))
      : false;

    refs.push({
      specifier,
      typeOnly: isTypeKeyword || allBindingsTyped,
    });
  }

  return refs;
}

/** Resolve a first-party specifier to a file on disk, or null if external. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Not this extension; try the next.
    }
  }
  return null;
}

const rel = (file: string) =>
  path.relative(process.cwd(), file).replace(/\\/g, "/");

/**
 * Walk everything reachable from `entry` and report server-only value imports.
 * Returns a readable chain per violation, because "something in the graph
 * imports inngest" is not a message anyone can act on.
 */
function findServerOnlyReach(entry: string): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);

    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly) continue;

      if (
        SERVER_ONLY_MODULES.includes(specifier) ||
        NODE_BUILTIN.test(specifier)
      ) {
        violations.push(
          `${[...chain, rel(file)].join("\n    → ")}\n    → imports "${specifier}" as a VALUE`,
        );
        continue;
      }

      const local = resolveLocal(file, specifier);
      if (local) walk(local, [...chain, rel(file)]);
    }
  };

  walk(entry, []);
  return violations;
}

/** Every `definition.ts` under `src/nodes`, found without a glob dependency. */
function findDefinitions(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findDefinitions(full));
    } else if (entry.name === "definition.ts") {
      found.push(full);
    }
  }
  return found;
}

describe("node catalogue client boundary (AF-M10-16)", () => {
  const definitions = findDefinitions(NODES_ROOT);

  it("finds the node definitions to check", () => {
    // A glob that silently matched nothing would make every assertion below
    // vacuously true — the most comfortable way for this guard to stop working.
    expect(definitions.length).toBeGreaterThan(40);
  });

  it("no node definition reaches a server-only module", () => {
    // Deduplicated: one shared module pulled in by nine definitions is one
    // bug, and printing it nine times buries the other eight failures.
    const failures = [
      ...new Set(
        definitions.flatMap((definition) => findServerOnlyReach(definition)),
      ),
    ];

    expect(
      failures,
      failures.length > 0
        ? `These are bundled into the editor (a client component) and will fail \`next build\`:\n\n${failures.join("\n\n")}`
        : "",
    ).toEqual([]);
  });

  it("the manifest itself reaches no server-only module", () => {
    // The definitions are checked individually above; this covers the
    // manifest's own imports, which is what the editor actually pulls in.
    expect(findServerOnlyReach(path.join(NODES_ROOT, "manifest.ts"))).toEqual(
      [],
    );
  });

  it("detects a violation when one exists", () => {
    // Guards that can only pass are worthless. `execute.ts` files legitimately
    // import `inngest` and `server-only`, so one proves the walker actually
    // fires rather than silently resolving nothing.
    const executor = path.join(
      NODES_ROOT,
      "quickbooks",
      "create-invoice",
      "execute.ts",
    );
    expect(findServerOnlyReach(executor).length).toBeGreaterThan(0);
  });

  it("treats a type-only import as erased", () => {
    // `src/nodes/types.ts` imports `GetStepTools` from inngest with
    // `import type`, and every definition imports `NodeDefinition` from it.
    // Flagging that would make the guard unusable and it would be turned off.
    expect(findServerOnlyReach(path.join(NODES_ROOT, "types.ts"))).toEqual([]);
  });
});
