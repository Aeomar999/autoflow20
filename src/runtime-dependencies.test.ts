import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every package the server reaches at runtime must be a production dependency.
 *
 * **Why this exists.** `src/features/files/server/html-to-pdf.ts` imported
 * `jsdom`, which was declared in `devDependencies`. Locally and during
 * `next build` that resolves fine — dev dependencies are installed in both —
 * so `tsc`, Biome, 1542 tests and the Vercel build were all green. The
 * serverless runtime is the one place they are absent, and `jsdom` is on
 * Next's default `serverExternalPackages` list, so webpack does not inline it:
 * the server output keeps a bare `require("jsdom")` to be resolved from
 * `node_modules` at boot.
 *
 * The result was a `MODULE_NOT_FOUND` thrown at *module initialisation*, which
 * takes down the whole route rather than one request. Because
 * `src/nodes/registry.ts` imports every executor, and `templatesRouter`
 * imports the registry, that one file was reachable from `appRouter` — so
 * every dashboard page and all of `/api/trpc` returned a hard 500 while `/`,
 * `/login`, `/api/health` and `/api/v1/*` kept working. Production was down;
 * nothing in the repo failed.
 *
 * A misdeclared dependency only bites when webpack *cannot* inline the
 * package, which makes it worse, not better: `stripe` was misdeclared the same
 * way and survived purely because it happens to be bundled. That is luck, and
 * it silently expires whenever Next changes its externals list. This checks the
 * declaration, not the bundling outcome.
 *
 * Type-only imports are erased before any bundle exists, so they are allowed —
 * `@types/*` packages are legitimately dev dependencies.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");

const packageJson = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf-8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const PRODUCTION_DEPS = new Set(Object.keys(packageJson.dependencies ?? {}));
const DEV_DEPS = new Set(Object.keys(packageJson.devDependencies ?? {}));

/**
 * Files Next actually runs on the server. Route handlers, the App Router's
 * special files, the Inngest functions, and the instrumentation hook — each is
 * an entry whose whole import graph is loaded before a request is served.
 */
const ENTRY_FILE =
  /\/(route|page|layout|template|error|not-found|default)\.tsx?$/;

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

/**
 * Read a file's imports.
 *
 * The clause is `[^;]*?`, not `[\s\S]*?`: a lazy any-character clause
 * happily spans a statement boundary, so `import "server-only";` followed by
 * `import type { JSDOM } from "jsdom";` matched as ONE import whose `type`
 * keyword had been skipped, reporting a type-only import as a value import.
 * A semicolon ends a statement and never appears inside an import clause.
 *
 * Deliberately a regex rather than a parser, for the same reason as
 * `src/nodes/client-boundary.test.ts`: these are first-party files with
 * `biome format` applied, the shapes are uniform, and a test that needs its
 * own TypeScript program to run is a test people delete.
 */
function importsOf(file: string): ImportRef[] {
  const source = readFileSync(file, "utf-8");
  const refs: ImportRef[] = [];

  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)?from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

  for (const match of source.matchAll(pattern)) {
    const bareSpecifier = match[4];
    if (bareSpecifier) {
      refs.push({ specifier: bareSpecifier, typeOnly: false });
      continue;
    }

    const specifier = match[3];
    if (!specifier) continue;

    const isTypeKeyword = Boolean(match[1]);
    const clause = match[2] ?? "";
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
    base = path.join(SRC, specifier.slice(2));
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
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** `@scope/name/deep/path` and `name/deep/path` both name one package. */
function packageNameOf(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] as string);
}

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");

/** Every server entrypoint, found without a glob dependency. */
function findEntrypoints(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findEntrypoints(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;

    const relative = rel(full);
    if (relative.startsWith("src/app/") && ENTRY_FILE.test(`/${entry.name}`)) {
      found.push(full);
    } else if (relative.startsWith("src/inngest/")) {
      found.push(full);
    } else if (relative === "src/instrumentation.ts") {
      found.push(full);
    }
  }
  return found;
}

interface Violation {
  packageName: string;
  where: "devDependencies" | "undeclared";
  chain: string[];
}

/**
 * Walk everything reachable from the given entrypoints and report value
 * imports of packages that will not exist at runtime. Returns the import chain
 * per violation, because "something imports jsdom" is not actionable.
 */
function findNonProductionImports(entrypoints: string[]): Violation[] {
  const violations = new Map<string, Violation>();
  const seen = new Set<string>();
  const parent = new Map<string, string | null>();

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    let current: string | null = file;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      chain.unshift(rel(current));
      current = parent.get(current) ?? null;
    }
    return chain;
  };

  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);

    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly) continue;
      // A template literal inside an import-looking string, not a specifier.
      if (specifier.includes("$")) continue;

      const local = resolveLocal(file, specifier);
      if (local) {
        if (!parent.has(local)) parent.set(local, file);
        walk(local);
        continue;
      }

      if (specifier.startsWith(".") || specifier.startsWith("@/")) continue;
      if (specifier.startsWith("node:")) continue;

      const packageName = packageNameOf(specifier);
      if (PRODUCTION_DEPS.has(packageName)) continue;
      if (violations.has(packageName)) continue;

      violations.set(packageName, {
        packageName,
        where: DEV_DEPS.has(packageName) ? "devDependencies" : "undeclared",
        chain: chainTo(file),
      });
    }
  };

  for (const entry of entrypoints) {
    if (!parent.has(entry)) parent.set(entry, null);
    walk(entry);
  }

  return [...violations.values()];
}

const format = (violation: Violation) =>
  `"${violation.packageName}" is in ${violation.where}, but the server imports it at runtime:\n    ${violation.chain.join("\n    → ")}`;

describe("runtime dependencies are production dependencies", () => {
  const entrypoints = findEntrypoints(SRC);

  it("finds the server entrypoints to check", () => {
    // A walk that silently matched nothing would make the assertion below
    // vacuously true — the most comfortable way for this guard to stop working.
    expect(entrypoints.length).toBeGreaterThan(50);
  });

  it("no server entrypoint reaches a non-production package", () => {
    const violations = findNonProductionImports(entrypoints).sort((a, b) =>
      a.packageName.localeCompare(b.packageName),
    );

    expect(
      violations.map(format),
      violations.length > 0
        ? "These resolve locally and during `next build`, but are absent from the serverless runtime. Move them to `dependencies`."
        : "",
    ).toEqual([]);
  });

  it("detects a violation when one exists", () => {
    // Guards that can only pass are worthless. The test files themselves
    // legitimately import `vitest`, so one proves the walker actually fires
    // rather than silently resolving nothing.
    const violations = findNonProductionImports([__filename]);
    expect(violations.map((violation) => violation.packageName)).toContain(
      "vitest",
    );
  });

  it("treats a type-only import as erased", () => {
    // A guard that flagged `import type` would be turned off within a day:
    // `@types/*` packages are correctly dev dependencies.
    //
    // `html-to-pdf.ts` opens with a side-effect import followed immediately
    // by two type-only ones, which is the exact shape that defeated the
    // earlier clause pattern: it swallowed the newline and reported both type
    // imports as values, which is how a deferred package slipped back onto the
    // module-init path unnoticed. Pinning all three stops that returning.
    const htmlToPdf = path.join(SRC, "features/files/server/html-to-pdf.ts");
    const refs = importsOf(htmlToPdf);
    const typeOnlyOf = (specifier: string) =>
      refs.find((ref) => ref.specifier === specifier)?.typeOnly;

    expect(typeOnlyOf("server-only")).toBe(false);
    expect(typeOnlyOf("jsdom")).toBe(true);
    expect(typeOnlyOf("pdfmake/interfaces")).toBe(true);
  });
});

/**
 * Packages that must never load while a route's module graph is evaluating.
 *
 * `pdf-parse` reaches `pdfjs-dist`, which asks for `@napi-rs/canvas` through a
 * `createRequire` it builds at runtime. Neither webpack nor Vercel's file
 * tracer can see through that, so the package installs during the build and is
 * absent from the lambda; pdfjs then cannot polyfill `DOMMatrix` and throws
 * `ReferenceError: DOMMatrix is not defined` while its module body evaluates.
 *
 * Because it throws at module initialisation rather than on use, it took down
 * every route that merely *reached* the file — `src/nodes/registry.ts` imports
 * every executor, so that was all of them — while `/`, `/login` and
 * `/api/health` stayed up. `next build` passes and every local run passes,
 * because `@napi-rs/canvas` is installed in both.
 *
 * The rule is not "do not depend on pdf-parse". It is that only the runner
 * ever parses a PDF, so it must be reached by `await import()` inside the
 * branch that needs it, never by a static import that a page can pull in.
 */
/**
 * `jsdom` was the second one, and it failed differently: it reaches
 * `html-encoding-sniffer`, a CommonJS package that `require()`s the ESM-only
 * `@exodus/bytes`. All three declare `node: ^20.19.0 || ^22.12.0 || >=24.0.0`,
 * the versions where `require(esm)` works. Local runs on Node 24 were green;
 * the deploy ran something older and threw ERR_REQUIRE_ESM on import.
 *
 * Two different faults, one shape: a package the runner alone needs, evaluated
 * while a page boots. That is what this list is for.
 */
const DEFERRED_ONLY = [
  "pdf-parse",
  "pdfjs-dist",
  "@napi-rs/canvas",
  "jsdom",
  "pdfmake",
  "html-to-pdfmake",
];

/** Static-import chains from `entrypoints` that reach `packageName`. */
function findStaticReach(entrypoints: string[], packageName: string): string[] {
  const chains: string[] = [];
  const seen = new Set<string>();

  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return;
    seen.add(file);

    for (const { specifier, typeOnly } of importsOf(file)) {
      if (typeOnly) continue;
      if (packageNameOf(specifier) === packageName) {
        chains.push([...chain, rel(file)].join("\n    → "));
        continue;
      }
      const local = resolveLocal(file, specifier);
      if (local) walk(local, [...chain, rel(file)]);
    }
  };

  for (const entry of entrypoints) walk(entry, []);
  return chains;
}

describe("heavy native packages stay off the module-init path", () => {
  const entrypoints = findEntrypoints(SRC);

  it.each(DEFERRED_ONLY)(
    "no server entrypoint statically imports %s",
    (packageName) => {
      const chains = [...new Set(findStaticReach(entrypoints, packageName))];

      expect(
        chains,
        chains.length > 0
          ? `Reached at module scope, so it evaluates before any request is served. Load it with \`await import()\` in the branch that needs it:\n\n${chains.join("\n\n")}`
          : "",
      ).toEqual([]);
    },
  );

  it("detects a static import when one exists", () => {
    // Guards that can only pass are worthless. `mammoth` is legitimately a
    // static import in the same extractor, so it proves the walker fires.
    expect(findStaticReach(entrypoints, "mammoth").length).toBeGreaterThan(0);
  });
});
