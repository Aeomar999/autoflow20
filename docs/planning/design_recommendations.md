# AutoFlow — Design Recommendations, Grounded in the Actual Stack

**Date:** 2026-09-06
**Status:** Analysis / recommendations. Every claim below was verified against the cited ADR or source file at time of writing, not against `AGENTS.md` (whose reality-check table lags the code by several milestones).
**Grounded in:** ADR-0002, 0004, 0006, 0007, 0018, 0019, 0020, 0022, 0023 · `docs/architecture/security.md` · node inventory in `src/nodes/**`.

---

## 4. Expression language

**Recommendation: keep ADR-0006's constraint, and treat ADR-0007's central choke point as the thing you never fork.**

- Expressions are **never `eval`/`new Function`/`vm` on the request or execution path**. The carve-outs are exact and named: the CODE node (ADR-0020, worker + `node:vm`, below) and nothing else.
- The shipped surface is **Handlebars runtime compilation, hardened centrally**. All executors compile through `src/features/executions/template.ts` → `compileTemplate(source)`, which pins `allowProtoPropertiesByDefault: false` and `allowProtoMethodsByDefault: false` **explicitly** so a Handlebars upgrade cannot silently relax them. Direct `Handlebars.compile` outside that wrapper is banned.
  - Proto-chain probes (`constructor`, `__proto__`, `toString`, `hasOwnProperty`), globals (`process`, `globalThis`, `require`) all render `""`; there is no route to globals because the engine never places them in the data context (verified probe results in ADR-0007 §Verification).
- Expression surface, per ADR-0007 amendments:

  | Expression | Resolves to |
  |---|---|
  | `{{$json.field}}` | Alias for the node's resolved input (per ADR-0019 input resolution) |
  | `{{$node.[Node Name].field}}` | Output of a named upstream node, keyed by canvas display name |
  | `{{$execution.id}}` / `{{$workflow.id}}` | Current execution / workflow id |
  | `{{$now}}` | ISO-8601 timestamp at context build time |

  `$env` is intentionally **omitted** (Phase 1); `$items` (n8n-style item array) is deferred with the items model. Adding `$env` later must go through `buildTemplateContext` with an allowlist — same plumbing as `$execution`/`$workflow`.
- **Fixed helper set:** `EXPRESSION_HELPERS` in `src/features/executions/template.ts` is the single source of truth shared by runtime registration and graph validation. `default`, `get`, `json`, `eq/ne/gt/gte/lt/lte`, `and/or/not`, `add/sub/mul/div`, `len`, `upper/lower`, `formatDate`. Comparisons numeric-when-finite; `div` by zero throws; unparseable `formatDate` throws.
- **Unescaped-JSON rule:** Handlebars HTML-escapes by default; the *only* raw-JSON path is `{{{json v}}}`. Every JSON-body node validates the compiled result still parses as JSON — a malformed template is a config error, never a silent body substitution.
- **Save-time root validation:** `checkTemplateRoots` (`src/engine/validate.ts`) infers every root the graph can produce and emits a **warning** when a template references a root outside that union — so a ported n8n expression like `{{$json.body.x}}` fails loudly at save instead of silently rendering `""`. It parses with `Handlebars.parse` and walks the AST; no template is ever *compiled* during validation.
- `ExpressionError` (from `template.ts`) carries the expression string and optional node name; in Phase 1 missing paths resolve to `""`, with `ExpressionError` reserved for structural errors detected pre-compilation.
- **Editor follow-through:** the static analyzability ADR-0006 promised is now real — `getTemplateRoots` already does the graph inference. The editor should surface the same warnings/autocomplete inline (roots = always-present keys + every node's `variableName` + every SET mapping key + trigger-seeded keys). This is the strongest wedge vs. n8n's "unintuitive, JS-flavored" expressions and it is almost free to ship.
- **Guardrail to carry:** the `AF-M2-03` injection-inertness tests in `template.test.ts` (9 proto-chain + 3 global probes; the full `$`-prefixed surface) are a regression lock over every Handlebars upgrade. Do not weaken them. If the helper allowlist ever starts growing without bound, that is the signal to adopt a real expression language (e.g. CEL-lite) via a new ADR — not to loosen the no-JS rule.

## 5. Execution engine

**Recommendation: the engine is built — the remaining risk is that its numbers stay unmeasured, not that its design is wrong.**

- **Durable runtime:** Inngest, per ADR-0002. Nodes run inside `step.run(...)` so completed steps are memoized and a resumed run never re-invokes side effects (correctness property P2). The seam is real and must survive review: `src/engine/` owns compile, plan, expression resolution, state recording; Inngest owns durability/scheduling. **`src/engine/` stays free of Inngest imports except the runner entry point** — this is what keeps the engine unit-testable standalone.
- **Output bounding (ADR-0018, implemented):** per-node output is capped at 1 MiB by `MAX_NODE_OUTPUT_BYTES` in `src/inngest/config.ts`; exceeding it throws a `NonRetriableError` naming the node and size. **Loud failure, never silent truncation** — a workflow that silently drops half an API response looks right while being wrong.
  - The threshold is *provisional, not measured* (derived from Inngest's published 4 MiB step / 32 MB run-state caps). AF-M2-00's measurement work (a workflow of `n` nodes returning a known size, increased until it breaks) is recorded in `docs/engineering/inngest_limits.md` §7 but the number behind the guardrail is still arithmetic. **Reconsider blob-spill only after AF-M9-12's per-node input resolution is measured in production** — not before.
- **Per-node input resolution (ADR-0019, implemented):** `nodeOutputs` is the source of truth; each node's input is built from its incoming edges via `buildNodeInput`, collapsing the old quadratic run-state growth `b·n(n+1)/2` back to roughly `b·n`. The flat rolling `context` survives as a **read-only** view so every existing workflow and seeded template keeps resolving identically on linear chains.
  - Branch isolation is now correct and tested: in `A → (B, C) → D`, C receives A's output, not B's.
  - Execution is sequential in topological order by design — "fan-out" means branch isolation, **not** parallelism. Concurrency is a separate, later decision (do not sneak it into a bugfix PR).
- **Inngest caps (from ADR-0018):** 4 MiB per-step return, 32 MB total run state, 1000 steps/run. The engine opens five steps per node, so step count binds around ~198 nodes — not the binding constraint. Run-state size was; ADR-0019 fixed the real cause.

## Credentials

**Recommendation: the model exists and is strong — do not re-litigate it; the remaining work is surface and discipline.**

- **Envelope encryption (ADR-0004):** AES-256-GCM per-credential DEK under a KEK (`CREDENTIAL_MASTER_KEY`); `keyVersion` per row enables rolling rotation without re-encrypting payloads; GCM means tampering fails loudly. **There is no read path for plaintext** — no tRPC procedure, REST endpoint, server action, or server component returns decrypted material, ever. The single decrypt call site is the engine's `NodeExecutionContext` construction. UI shows only a non-reversible `preview`.
- **Credential model + registry (ADR-0008) and scoped Google types (ADR-0023):** credential type is an open set (string, not enum — this was the `NodeType` bug class), with a wildcard grammar (`"*"`, `"a|b"`) in `CredentialRequirement.type` matched by `acceptedCredentialTypes` (`src/features/credentials/credential-match.ts`).
- **Generic HTTP auth (ADR-0022, implemented):** `HTTP_REQUEST` declares an optional `credentials: [{ key: "credentialId", type: "*" }]`; secret material is read **only** from `NodeRunParams.credentials` — never from `data`, because `data` becomes `NodeExecution.input` (the trace row). `authMode: none | bearer | header | basic | queryParam | oauth2`, translated by exactly one module (`buildHttpAuth`, `src/nodes/shared/http-auth.ts`). OAuth reads `accessToken` only, never falls back to an API key; token freshness is the `refresh-oauth-tokens` cron's job, not the executor's.
  - **Cross-origin redirect:** auth headers (including custom names like `X-API-Key`) are stripped when a redirect leaves the origin; same-origin redirects keep them. This list is `credentialHeaderNames` feeding `createSafeFetch` — do not regress it when editing http code.
  - **Echo redaction:** `redactSecrets` (`src/nodes/shared/redact.ts`) replaces every secret actually sent with `[redacted]` before output leaves the executor (covers debug/echo endpoints; also the base64 blob for `basic`). `< 6`-char values are deliberately not scanned. Test in `src/nodes/http/request/execute.test.ts` asserts a token in config is *ignored* and the node fails unbound.
- **What to watch:** the credentials **UI** likely still lags the model (stub pages were the state recorded in `AGENTS.md`; verify against code before claiming). The no-read-path and redaction invariants belong in the test suite permanently — a regression here is a credential disclosure, the highest-consequence defect class (T1/T2).

## Code node sandbox (ADR-0020, implemented — `src/nodes/core/code/`)

- User code runs in a **dedicated worker thread**; inside that worker only, it executes in a `node:vm` context. The `vm` call is never on the main/Inngest thread.
- **No host bindings:** fresh realm with standard intrinsics only — no `require`, `import`, `process`, `buffer`, `setTimeout`, `fetch`, no meaningful `global`/`globalThis`.
- **The escape that was actually found and closed:** the input is **not** injected as a host object (cross-realm `constructor.constructor("return process")()` leaks). It is passed as `workerData.inputJson` and `JSON.parse`d *inside* the vm context, so the user's code only ever reaches vm-realm objects. `execute.test.ts` pumps every cross-realm vector through input, nested input, literals, and `JSON.parse`.
- **Hard caps, all loud `NonRetriableError`, never silent truncation:** wall clock 5s/30s ceiling, heap 64 MB/256 MB ceiling (`worker.resourceLimits`), output 1 MB. A runaway starves one Worker the parent kills — the main process never runs user code at full privilege.
- Errors carry the **user's line number** (wrapper prefix rebasing) and no internal paths or payload. No module loading, period — code is a function body `(input) => {...}` returning an object (output) or array (`items` for SPLIT_OUT).
- **Honest ceiling:** worker+vm is the strongest isolation available in-process without a new runtime. Per-execution containers / WASM / a vendor sandbox is the Phase 3 destination and can replace the sandbox *without changing the node's public contract* (it is confined to one module, `runUserCode`). Don't let the CODE node's existence justify loosening ADR-0006 elsewhere.

## 11. Design recommendations, grounded in the actual stack

1. **Protect the registry.** Everything user-visible on the canvas is a `NodeDefinition` in `src/nodes/`; `execute()` stays server-only (`import "server-only"`); never special-case a node type outside `src/nodes/`. The wildcard-credential model (ADR-0022) is why most of Phase B becomes config, not node families — keep it that way.
2. **Spend the next effort on the editor, not the runtime.** The engine, sandbox, and credential plumbing are built and tested. What is *not* built is the expression authoring UX — inline `getTemplateRoots` warnings and root autocomplete are nearly free and directly attack the documented market gap (unintuitive competitor expressions).
3. **Measure the two numbers ADR-0018 flagged, then delete the caveats.** The 1 MiB output threshold and the blob-spill decision both rest on arithmetic over published limits, not measurement. Run the `inngest_limits.md` §7 experiment; per-node input resolution (ADR-0019) has now changed the curve it measures anyway.
4. **Treat credential invariants as permanent test surface.** No-plaintext-read-path, executor-only secret access, cross-origin auth stripping, echo redaction, `redactSecrets` — every one has a regression test today; keep them green across refactors, and add the same class of test to any new node that authenticates.
5. **Don't reintroduce concurrency by the side door.** ADR-0019 made branch isolation sequential by design. Parallelism changes failure/retry semantics, ordering, and the trace — it is a deliberate later decision, not a "fast follow" on a bugfix PR.
6. **Docs discipline.** `AGENTS.md`'s reality-check table (no engine, stub credentials page, "node library: one type") is now several milestones stale — the code contradicts it. Correct `AGENTS.md`/`progress.md`/`tasks.md` in the same change as the work that falsifies them, per section 4 of the operating manual.
7. **No silent failures, no attribution, no `catch {}`.** Still the standing conventions; the two known violations (hardcoded Polar IDs, `AF-M0-03`) are tracked, not copied.