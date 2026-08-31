# Node SDK — the contract for everything on the canvas

**Status:** Specification. Implemented by `AF-M1-01`.
**Read before:** adding a node type, changing node config handling, or touching the palette/config panel.

The node registry is AutoFlow's core abstraction. If you find yourself writing `if (node.type === "...")` anywhere outside `src/nodes/`, stop — the registry is missing a capability and the fix is to extend `NodeDefinition`, not to special-case.

---

## 1. Why it is shaped this way

Three consumers need to know things about a node, and they need to agree:

| Consumer | Needs |
|---|---|
| Editor (browser) | label, icon, category, ports, config schema — to render the palette, the node, and its form |
| API (server) | config schema — to validate a save |
| Engine (server) | config schema **+ implementation** — to run it |

If those live in three places they diverge, and the symptom is a workflow that validates in the editor and fails at runtime. So there is exactly one definition, split by *environment* rather than by consumer:

```
src/nodes/<namespace>/<node>/
├── definition.ts   # isomorphic — safe in the browser bundle
├── execute.ts      # server-only — the implementation
├── index.ts        # server — composes both
└── execute.test.ts # unit tests
```

`src/nodes/manifest.ts` imports only `definition.ts` files. `src/nodes/registry.ts` imports `index.ts` files. The bundler therefore **cannot** pull an implementation into the client, regardless of what someone imports by accident.

---

## 2. Types

```ts
// src/nodes/types.ts
import type { z } from "zod";

export type NodeCategory =
  | "TRIGGER" | "ACTION" | "LOGIC" | "AI" | "DATA" | "TRANSFORM";

export interface PortDef {
  /** Stable id used as the React Flow handle id and Connection.fromOutput/toInput */
  id: string;
  label: string;
  /** A run fails validation if a required input port has no incoming connection */
  required?: boolean;
  description?: string;
}

export interface CredentialRequirement {
  /** Key in the node's resolved credential map */
  key: string;
  /** Credential type id from the credential registry, e.g. "slack.oauth2" */
  type: string;
  required: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;      // 1 = no retry
  backoffMs: number;        // base for exponential backoff
  retryOn?: (error: unknown) => boolean;
}

export interface NodeDefinition<TConfig = unknown> {
  /** Stable, namespaced, permanent. Never rename — it is persisted in Node.type. */
  type: string;
  /** Bump when configSchema changes incompatibly; requires a migration fn. */
  version: number;
  category: NodeCategory;
  label: string;
  description: string;
  /** lucide-react icon name */
  icon: string;
  /** Palette search terms */
  keywords?: string[];
  /** Zod schema — the single source of truth for config. Drives the form AND validation. */
  configSchema: z.ZodType<TConfig>;
  defaults: TConfig;
  inputs: PortDef[];        // [] for triggers
  outputs: PortDef[];
  credentials?: CredentialRequirement[];
  /** Honours a `cacheTtlSeconds` field against the workspace AI response cache (M5-07) */
  supportsResponseCache?: boolean;
  defaultRetry?: RetryPolicy;
  /** Wall-clock cap for one attempt */
  timeoutMs?: number;
  /** Migrate a saved config from an older typeVersion */
  migrate?: (config: unknown, fromVersion: number) => TConfig;
  /** Docs link rendered in the config panel */
  docsUrl?: string;
  /** Retirement marker — see §6.1. Still registered, no longer offered. */
  deprecated?: { since: string; replacedBy: string; reason: string };
}

/** The uniform data unit passed between nodes. */
export interface Item {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;
}

export interface BinaryRef {
  /** Blob storage key — binary is never inlined into execution records */
  key: string;
  mimeType: string;
  fileName?: string;
  sizeBytes: number;
}

export interface NodeExecutionContext<TConfig = unknown> {
  /** Validated, expression-resolved config */
  config: TConfig;
  /** Items from the incoming connection(s) */
  items: Item[];
  /** Decrypted credentials, keyed by CredentialRequirement.key. Never log these. */
  credentials: Record<string, Record<string, string>>;
  /** Allowlisted environment values only — never process.env */
  env: Record<string, string>;
  execution: { id: string; workflowId: string; mode: "PRODUCTION" | "TEST"; startedAt: Date };
  node: { id: string; name: string; type: string };
  /** Aborted on cancellation or timeout — pass to fetch() */
  signal: AbortSignal;
  /** Redacting logger scoped to this node execution */
  logger: NodeLogger;
  /** Resolve an expression against the run context at execution time */
  resolve: <T = unknown>(expression: string) => T;
}

export interface NodeResult {
  /** Items emitted on the default output */
  items: Item[];
  /** For multi-output nodes (e.g. condition): port id → items. Overrides `items`. */
  outputs?: Record<string, Item[]>;
  /** Reported to the trace; used for cost rollups */
  usage?: { tokensIn?: number; tokensOut?: number; costUsd?: number };
}

export type NodeExecute<TConfig> =
  (ctx: NodeExecutionContext<TConfig>) => Promise<NodeResult>;
```

### Errors

```ts
export class NodeExecutionError extends Error {
  constructor(
    message: string,                       // user-actionable, no secrets
    readonly options: {
      code: string;                        // e.g. "HTTP_4XX", "AUTH_FAILED"
      retryable: boolean;
      /** Safe, structured context shown in the trace */
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) { super(message); }
}
```

**Message quality is a review criterion.** `"Request failed"` is rejected. `"Slack API returned 429 (rate limited). Retry after 30s."` is accepted. The user debugging at 2am is the customer for this string.

---

## 3. A complete example

```ts
// src/nodes/http/request/definition.ts
import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

export const configSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().min(1).describe("Request URL. Supports expressions."),
  headers: z.record(z.string(), z.string()).default({}),
  query: z.record(z.string(), z.string()).default({}),
  body: z.string().optional().describe("Raw body. JSON is sent as-is."),
  timeoutMs: z.number().int().min(100).max(120_000).default(30_000),
  failOnHttpError: z.boolean().default(true),
});

export type HttpRequestConfig = z.infer<typeof configSchema>;

export const definition: NodeDefinition<HttpRequestConfig> = {
  type: "http.request",
  version: 1,
  category: "ACTION",
  label: "HTTP Request",
  description: "Call any HTTP endpoint and return the response.",
  icon: "Globe",
  keywords: ["api", "rest", "fetch", "webhook", "curl"],
  configSchema,
  defaults: configSchema.parse({ url: "" }),
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "auth", type: "http.generic", required: false }],
  defaultRetry: { maxAttempts: 3, backoffMs: 1000 },
  timeoutMs: 120_000,
  docsUrl: "/docs/nodes/http-request",
};
```

```ts
// src/nodes/http/request/execute.ts
import "server-only";
import type { NodeExecute } from "@/nodes/types";
import { NodeExecutionError } from "@/nodes/types";
import { assertSafeUrl } from "@/lib/ssrf";
import type { HttpRequestConfig } from "./definition";

export const execute: NodeExecute<HttpRequestConfig> = async (ctx) => {
  const { method, url, headers, query, body, timeoutMs, failOnHttpError } = ctx.config;

  assertSafeUrl(url); // throws on loopback / link-local / internal ranges

  const target = new URL(url);
  for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);

  const auth = ctx.credentials.auth;
  const finalHeaders = auth?.headerName
    ? { ...headers, [auth.headerName]: auth.headerValue }
    : headers;

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([ctx.signal, timeout]);

  let response: Response;
  try {
    response = await fetch(target, { method, headers: finalHeaders, body, signal });
  } catch (cause) {
    throw new NodeExecutionError(`Could not reach ${target.host}.`, {
      code: "NETWORK_ERROR", retryable: true, cause,
    });
  }

  const text = await response.text();

  if (failOnHttpError && !response.ok) {
    throw new NodeExecutionError(
      `${target.host} returned ${response.status} ${response.statusText}.`,
      {
        code: `HTTP_${Math.floor(response.status / 100)}XX`,
        retryable: response.status === 429 || response.status >= 500,
        details: { status: response.status, bodyPreview: text.slice(0, 500) },
      },
    );
  }

  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch {
    ctx.logger.debug("Response body is not JSON; returning raw text.");  // ← ignorable, and says why
  }

  return {
    items: [{
      json: {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: parsed,
      },
    }],
  };
};
```

```ts
// src/nodes/http/request/index.ts
import { definition } from "./definition";
import { execute } from "./execute";
export default { ...definition, execute };
```

Note the one `catch` with an empty-ish body: it logs *why* the failure is ignorable. That is the only acceptable form. A bare `catch {}` is not.

---

## 4. Adding a node — checklist

1. Create `src/nodes/<namespace>/<node>/`.
2. Write `definition.ts`. Pick a permanent `type` id (`namespace.node`, lowercase, dot-separated). **Renaming it later breaks every saved workflow.**
3. Write `execute.ts` starting with `import "server-only"`.
4. Write `index.ts`.
5. Register the folder in `src/nodes/registry.ts` and `src/nodes/manifest.ts`.
6. Write `execute.test.ts` covering: happy path · upstream error · malformed config · zero input items.
7. Add `docs/nodes/<node>.md` with a config reference and a worked example.
8. Verify: the node appears in the palette, configures, saves, runs, and shows a useful trace.

**No other file changes.** If adding a node requires editing the editor, the runner, the API, or a migration, the registry has a gap — fix the gap.

---

## 5. Config schema rules

The config panel is generated from the Zod schema, so the schema must stay within a supported subset.

**Supported:**

| Zod | Renders as |
|---|---|
| `z.string()` | text input |
| `z.string()` + `.describe()` | text input with help text |
| `z.string().multiline()` (custom brand) | textarea |
| `z.number()` | number input |
| `z.boolean()` | switch |
| `z.enum([...])` | select |
| `z.record(z.string(), z.string())` | key/value editor |
| `z.array(z.object({...}))` | repeatable group |
| `z.object({...})` | fieldset |
| `.optional()` / `.default()` | optional field / prefilled |
| `credentialRef("slack.oauth2")` (custom) | credential picker |
| `expr(z.string())` (custom brand) | expression-enabled input |

**Not supported — the form generator throws at dev time rather than rendering something wrong:** `z.union` of dissimilar shapes, `z.lazy`, recursive schemas, `z.any`, `z.unknown`, transforms that change the output shape, `z.custom` without a registered renderer.

Rules:
- Always provide `defaults` that satisfy `configSchema.parse()`.
- Use `.describe()` on every field. It becomes the field's help text; there is no second place to write it.
- Prefer many flat fields over one nested JSON blob. Nested JSON is invisible to validation and to search.
- Never put a secret in config. Secrets are credentials. A field named `apiKey` in a config schema is a review rejection.

---

## 6. Versioning and migration

`Node.typeVersion` records which version of a definition produced a saved config.

Bump `version` and supply `migrate` when you:
- remove or rename a config field,
- change a field's type,
- change the meaning of an existing value,
- add or remove a port.

```ts
migrate(config: unknown, fromVersion: number): HttpRequestConfig {
  if (fromVersion === 1) {
    const old = config as { url: string; timeout?: number };
    return configSchema.parse({ ...old, timeoutMs: (old.timeout ?? 30) * 1000 });
  }
  return configSchema.parse(config);
}
```

Migration runs on load (editor) and on compile (engine), never as a bulk DB rewrite — a workflow untouched for a year must still run.

**Additive changes** (a new optional field with a default) do not require a version bump.

### 6.1 Retiring a type

`migrate` handles versions *within* a type. It cannot express one type being
replaced by another — the credential keys and the config shape usually differ.
Retirement is a three-step lifecycle instead (**ADR-0011**):

1. **Deprecate.** Set `deprecated: { since, replacedBy, reason }`. The type
   stays in `nodeManifest` and in the registry with its `execute` intact, so
   saved workflows, published versions, and historical traces keep resolving
   and running. `nodeManifest` also exports `nodePalette` — the same list minus
   deprecated entries — and the node selector reads that, so the population can
   only shrink. The config panel renders the notice and names the replacement.
2. **Migrate.** Write a pure mapper beside the retired node that rewrites its
   config onto the replacement and validates against the replacement's own
   `configSchema`, then an idempotent, dry-run-by-default script that applies it
   to live `Node` rows. `AF-M5-09` is the worked example:
   `src/nodes/ai/legacy-migration.ts` + `npm run migrate:legacy-ai-nodes`.
   Graph snapshots are **not** rewritten — they are history.
3. **Remove.** Delete the folder only once no persisted `Node` row of that type
   remains anywhere. A separate task, never bundled with step 1.

**Never delete a registration outright.** `nodeRegistry.resolve()` throws on an
unknown type, which fails graph validation — a workflow that ran yesterday stops
running, and it surfaces at execution time on a customer's workflow.

---

## 7. Trigger nodes

Triggers have `inputs: []` and `category: "TRIGGER"`. They do not "execute" in the normal sense; they are entry points whose `execute` shapes the incoming trigger payload into items.

- A workflow has exactly one trigger. Enforced at validation time with an explanatory message, not silently.
- `core.webhook-trigger` config declares the path, HTTP method, auth mode, and response mode.
- `core.schedule-trigger` config declares a cron expression plus a timezone, and the panel shows the next three fire times.

---

## 8. Testing a node

```ts
import { describe, it, expect, vi } from "vitest";
import { execute } from "./execute";
import { makeCtx } from "@/test/node-context";   // test helper from AF-M0-06

describe("http.request", () => {
  it("returns parsed JSON on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ));
    const result = await execute(makeCtx({ config: { url: "https://api.example.com" } }));
    expect(result.items[0].json.body).toEqual({ ok: true });
  });

  it("throws a retryable error on 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 429 })));
    await expect(execute(makeCtx({ config: { url: "https://api.example.com" } })))
      .rejects.toMatchObject({ options: { retryable: true } });
  });

  it("refuses internal addresses", async () => {
    await expect(execute(makeCtx({ config: { url: "http://169.254.169.254/" } })))
      .rejects.toThrow(/not allowed/i);
  });
});
```

Mandatory per node: happy path · upstream failure · malformed config · zero input items. Nodes that take credentials additionally assert that no credential value appears in the returned items.

---

## 9. Anti-patterns

| Don't | Why | Do |
|---|---|---|
| `if (node.type === "slack")` outside `src/nodes/` | Unbounded branching; defeats the registry | Extend `NodeDefinition` |
| Read `process.env` in `execute` | Untestable; leaks deployment config into node behavior | `ctx.env` (allowlisted) |
| Module-level cache or mutable state | Breaks retries, parallel runs, and tenant isolation | Keep `execute` pure over `ctx` |
| Return credentials or echo config secrets in output | They land in the trace, which is user- and log-visible | Return only the payload |
| Silent partial success | The trace lies | Throw, or emit explicit per-item error entries |
| Rename a `type` id | Every saved workflow breaks | New type + `migrate` on the old one |
| Add a config field without `.describe()` | The form renders a mystery input | Describe every field |
