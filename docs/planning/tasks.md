# AutoFlow — Task Backlog

**Last updated:** 2026-08-26 (deep-plan reconciliation)
**Convention:** `AF-<milestone>-<nn>`. Tasks are ordered by dependency within a milestone.
**Status:** ⬜ todo · 🟡 in progress · ✅ done · ⏸️ blocked · ❌ cancelled

> **2026-08-26 DEEP-PLAN RECONCILIATION.** Horizon locked to an **internal demo**;
> sequencing locked **authoring UX (M1) before engine power (M2 remainder)**.
> Recorded decisions (full register in `implementation_plan.md` §0):
> **A)** extend the existing Inngest engine incrementally — the spec's items-model/
> fan-out/compile-stage rebuild is deferred post-beta; **B)** expressions stay on
> sandboxed Handlebars (ADR-0007), extended with `$json`/`$node`/`$execution`
> context helpers instead of a second parsed resolver (spec + ADR amended together);
> **D)** loops/fan-out explicitly out of scope until post-beta; **E)** knowledge base
> is **planned in** as new milestone **M-KB** (slotted between M5 and M6); **F)** AI
> copilot and node-count targets are descope-to-Phase-2. M2 is re-scoped against
> reality: per-node traces/step-runner already exist (AF-A-05) — see its header.

> **2026-08-22 RECONCILIATION.** An audit found that several M0/M1 tasks were
> marked done with "Shipped in PR #NN" references that collide with this repo's
> actual tutorial history (`code-with-antonio` PRs #17–#30) and describe work not
> present in the code. Those tasks have been reopened with reality notes. A new
> **M-A** milestone captures audit findings (security, harness, lint debt).
> Provenance rule going forward: a task is only checked after the change is
> verified on disk; reference the real commit/PR or write "verified directly".

**Before starting any task:** read `AGENTS.md` §7 (how to do a piece of work), then the spec routed in `AGENTS.md` §3 for your area. Update this file and `docs/planning/progress.md` in the PR that completes the task.

Estimates are for one engineer, in ideal days (`d`).

---

## M0 — Stabilize the base · 1 week

Goal: the repo becomes honest, testable, and safe to build on. No new product surface.
**Reconciliation:** none of M0-02…M0-09 is done in this codebase; statuses corrected 2026-08-22.

### ✅ AF-M0-00 · Commit pending editor work · 0.5d
The React Flow editor (`src/components/initial-node.tsx`, `src/components/react-flow/`, `src/components/workflow-node.tsx`, `src/config/node-components.ts`) is committed to `main` via the tutorial PR history (#17–#30). *(Provenance note: original text claimed "PR #19" of this project's numbering — actually tutorial lesson commits. Outcome achieved regardless.)*

**Acceptance**
- [x] Editor work tracked in git on `main`. *(Verified 2026-08-22.)*
- [ ] `npm run build` passes from a fresh clone. *(Unverified — deps install + build not yet exercised end-to-end in CI-less env.)*
- [x] `.next/` and `src/generated/` are gitignored.

---

### ✅ AF-M0-01 · Fix paginated count ignoring search · 0.5d
**Reality (2026-08-22):** the described bug does **not exist** in current code — `workflows.getMany`'s `count` already shares the same `where` clause as `findMany` (`src/features/workflows/server/routers.ts:161`). Marked done by verification; no regression test exists yet (blocked on harness, AF-M0-06).

**Acceptance**
- [x] `count` uses the identical `where` clause as `findMany`.
- [ ] Regression test for search+pagination totals. *(pending AF-M0-06)*

---

### ✅ AF-M0-02 · Remove dead code and boilerplate · 0.5d · DONE 2026-08-24
**Reality (2026-08-22):** previously marked shipped (PR #24) — none of it happened in this codebase.

**Acceptance**
- [x] `Post` table dropped via a new migration. (`20260824100000_drop_post_table` — `DROP TABLE IF EXISTS "Post"`; the model was already gone from `schema.prisma` but no migration had ever dropped it from deployed DBs.)
- [x] `src/app/sentry-example-page/` and `src/app/api/sentry-example-api/` deleted. (Stale `.next/types` validator entries required a `.next` cache clear before tsc passed again.)
- [x] Unused import `title` from `process` removed (`src/components/app-sidebar.tsx:28`). *(N/A on recheck: no such import exists — line 28 is now `const menuItems`.)*
- [x] `README.md` rewritten (see `AF-M0-09`). *(Done 2026-08-24.)*
- [x] `npm run lint` reports zero errors. *(Done in AF-A-06; biome check clean at 217 files.)*

---

### ✅ AF-M0-03 · Externalize Polar configuration · 0.5d · DONE 2026-08-24
**Reality (2026-08-22):** previously marked shipped (PR #23) — not done. `POLAR_SUCCESS_URL` is read only server-side (`src/lib/auth.ts:37`), so the client-side bug may be N/A; product-ID literals and the `"pro"` slug still need checking. No `src/lib/env.ts` exists.

**Acceptance**
- [x] `POLAR_PRODUCT_ID`, `POLAR_PRODUCT_SLUG`, `NEXT_PUBLIC_POLAR_PRODUCT_ID`, `NEXT_PUBLIC_POLAR_SUCCESS_URL` in env; no literals in source. *(Implemented via `src/lib/env.ts`: `POLAR_PRODUCT_ID` + `POLAR_PRODUCT_SLUG` server-side, `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` for the two client checkout calls. Residuals, intentional: `NEXT_PUBLIC_POLAR_PRODUCT_ID`/`NEXT_PUBLIC_POLAR_SUCCESS_URL` omitted — nothing in the client reads a product ID or success URL; the `"pro"` dev fallback lives once in `env.ts` (same single-point pattern as `publicAppUrl`). When `POLAR_PRODUCT_ID` is unset the checkout products list stays empty and the app still boots.)*
- [x] Env parsed and validated at boot by `src/lib/env.ts` (Zod); the app refuses to start with a clear message if a required var is missing. *(Done in AF-M0-08; new vars added as optional entries there.)*
- [ ] Checkout completes end to end in dev with the env-driven values. *(Unverifiable here — needs live DB + Polar sandbox; code paths verified by gates + grep (no literals remain). Dev must set `POLAR_PRODUCT_ID`.)*
- [x] `.env.example` created. *(Existed since AF-M0-08; updated with the three new vars + refreshed stale header note about env validation.)*

---

### ✅ AF-M0-04 · Remove the fake tRPC context · 0.25d · DONE 2026-08-24
**Reality (2026-08-22):** previously marked shipped (PR #25) — **still present**: `createTRPCContext` returns `{ userId: 'user_123' }` (`src/trpc/init.ts:11`).

**Acceptance**
- [x] Context contains no fabricated identity. (`createTRPCContext` returns `{}`; doc comment explains identity is per-procedure.)
- [x] Nothing in the codebase reads `ctx.userId`; identity comes from the Better Auth session. (grep-verified — only `protectedProcedure`'s `ctx.auth` carries identity.)
- [x] Comment on `baseProcedure` stating it is unauthenticated and must not touch tenant data.

Also fixed the user-facing "Unathorized" typo while in file.

---

### ✅ AF-M0-05 · Eliminate silent failures · 0.5d
**Reality (2026-08-22):** repo-wide grep finds zero empty catches / swallowed prefetch errors — the specific defect never existed here. Remaining: a lint gate to keep it that way (Biome, not ESLint), folded into M-A lint debt (AF-A-06).
**Status (2026-08-24):** gate is live (CI `npm run lint`); task closed.

**Acceptance**
- [x] Repo-wide grep for `catch {}`, `.catch(() =>`, `catch (e) {}` returns zero results outside tests.
- [x] Biome rule/gate fails CI on lint failures incl. suspicious patterns (gate live via `npm run lint` in `.github/workflows/ci.yml`, added with AF-A-06).
- [x] Prefetch helpers verified clean (`src/features/*/server/prefetch.ts`).

---

### 🟡 AF-M0-06 · Test harness + CI · 1.5d
**Reality (2026-08-22):** zero test files, no `.github/`, no vitest/playwright configs or devDeps. Everything after this task depends on being able to verify work.
**Status (2026-08-26):** harness complete except the DB-backed **e2e signup journey** (needs a running app + reachable Polar sandbox). Integration testing against real Postgres shipped 2026-08-26 — see §6 of `docs/engineering/testing_strategy.md`.

**Acceptance**
- [x] Vitest configured with path aliases matching `tsconfig.json`; `npm test` and `npm run test:watch` work.
- [x] Testing Library configured for component tests. *(2026-08-24: `@testing-library/react` + jsdom `dom` vitest project (`*.dom.test.{ts,tsx}`) + jest-dom matchers; first component test `src/components/upgrade-modal.dom.test.tsx` (3 tests). Fixed root-cause: inline `test.projects` don't inherit root `resolve.alias`/`setupFiles` — both now declared per project, which also unblocks `@/` imports in unit tests.)*
- [x] Playwright configured; smoke spec in `tests/e2e/auth-smoke.spec.ts` (unauth redirect → login; login form renders). Gated on `E2E_SERVER`/`E2E_BASE_URL`; full sign-up flow needs the DB-backed e2e pass below.
- [x] Test DB strategy documented and working (Docker Postgres or a dedicated test database), with per-suite truncation. *(2026-08-26: `integration` vitest project live against Docker postgres:16 on :5433; contract + local recipe in `testing_strategy.md` §6 — incl. the `127.0.0.1`-not-`localhost` Windows/wslrelay trap; setup hard-pins `DATABASE_URL` to the test DB before imports so dev/prod can never be truncated by a test run. First suite: 12 webhook-authz tests, all green locally.)*
- [x] `docs/engineering/testing_strategy.md` reflects the actual commands. *(§8 rewritten 2026-08-26 to match the real ci.yml; CI wiring of TEST_DATABASE_URL pending as noted there.)*
- [x] GitHub Actions workflow runs `lint`, `build`, `test` on push and PR (`.github/workflows/ci.yml`, node 20 + postgres:16 service).
- [x] At least one real test per layer exists as a template: unit ✓ (`src/inngest/utils.test.ts`, `src/lib/logger.test.ts`, `src/lib/secure-compare.test.ts`, `src/inngest/config.test.ts`), integration ✓ (`tests/integration/webhooks.authz.integration.test.ts`), e2e template ✓ (gated spec).

---

### ✅ AF-M0-07 · Structured logger with redaction · 0.5d
**Reality (2026-08-22):** no `src/lib/logger.ts`; three raw `console.error` calls in webhook routes + trigger utils log full error objects.

**Acceptance**
- [x] `src/lib/logger.ts` exposes `debug/info/warn/error` with structured context and env-based level (`LOG_LEVEL`, NODE_ENV default).
- [x] Keys matching `/(token|secret|password|apikey|api_key|authorization|cookie|credential|private[_-]?key)/i` are redacted at any nesting depth, including inside arrays.
- [x] Test proves a nested secret is redacted (`src/lib/logger.test.ts`).
- [x] Sentry `beforeSend` applies the same redaction (`src/instrumentation-client.ts`, client side).
- [x] Webhook `console.error` calls migrated to the logger (stripe/google-form routes).

---

### 🟡 AF-M0-08 · Environment validation and `.env.example` · 0.5d
**Reality (2026-08-22):** no `src/lib/env.ts`, and no `.env*` file of any kind exists in this checkout — the app cannot boot without provisioning secrets first.
**Status (2026-08-24):** env module shipped and wired at boot; docs sync remains.

**Acceptance**
- [x] `src/lib/env.ts` validates server env with Zod via cached `ensureEnv()`, called from `src/instrumentation.ts` at boot; exports typed values (`publicAppUrl`). `SKIP_ENV_VALIDATION=1` bypasses for CI/build.
- [x] Missing/invalid vars produce a single readable error naming each variable (from `result.error.issues`).
- [x] `.env.example` lists every variable with a dummy value and a one-line comment, including `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `POLAR_*`, provider keys, `STRIPE_WEBHOOK_SECRET` (AF-A-01), `ENGINE_RETRIES` (AF-A-07). *(Created 2026-08-22, verified against code; `!.env.example` gitignore exception added.)*
- [ ] `docs/operations/environment_setup.md` matches.

---

### ✅ AF-M0-09 · Real README + docs index · 0.5d · DONE 2026-08-24
**Reality (2026-08-22):** README is stock create-next-app boilerplate. `docs/README.md` exists but must be re-checked against the reconciled doc set.

**Acceptance**
- [x] `README.md` describes what AutoFlow is, current honest status (link `docs/planning/progress.md`), the stack, quick start, and links to the doc set.
- [x] `docs/README.md` indexes every document with a one-line "read this when". (Added the missing ADR-0007 row; all 20 files under `docs/` are covered.)
- [x] No `create-next-app` boilerplate remains.
- [x] Create root `AGENTS.md` referenced by this backlog's preamble. (§1 identity, §2 truth files, §3 spec routing, §4 hard rules, §5 gates, §6 conventions, §7 workflow — matching the preamble's references.)

### ✅ AF-M0-10 · Polar checkout success route · 0.5d · *(added 2026-08-26)* · DONE 2026-08-26
`POLAR_SUCCESS_URL` currently points at `/workflows` because no success page exists. Build the real one.

**Acceptance**
- [x] Route `/workflows/billing/success` renders post-checkout state. *(Client component under `(dashboard)/(rest)` so it renders inside the app shell with sidebar.)*
- [x] Refetches customer state on mount — invalidates the `["subscription"]` React Query cache that `useSubscription`/the sidebar read, so the upgrade button flips without a reload.
- [x] `.env.example` default updated to the real route (`{CHECKOUT_ID}` substitution supported by the plugin); duplicate `POLAR_SUCCESS_URL` block removed.
- [x] Update `.env` guidance in `polar_setup.md` §4.

---

### ✅ AF-M7-06 · Landing page at `/` · 2d · *(pulled forward from M7, 2026-08-26)* · DONE 2026-08-26
Currently a 404 that the sidebar logo links to; trivially demoable win, no dependencies.

**Acceptance**
- [x] Root route renders a real landing page (hero, honest capability copy matching `progress.md` §3 only, CTA → `/signup`; session-aware CTA shows "Open dashboard" for logged-in users).
- [x] Unauthenticated users see it without redirect (no global middleware exists; root page is outside the `(dashboard)` group).
- [x] Sidebar logo link now resolves authenticated and unauthenticated. Stale `create-next-app` root metadata replaced with real title/description.

---

## M-A — Audit hardening · 1.5 weeks · **do first**

New milestone opened by the 2026-08-22 audit (`progress.md` §5). Security findings S1–S3 are release blockers for anything public-facing.

### 🟡 AF-A-01 · Authenticate + authorize webhook triggers · 1d · **[HARD security]**
`POST /api/webhooks/stripe?workflowId=…` accepts unsigned bodies with arbitrary workflow IDs — anyone can trigger any user's workflow.
**Status (2026-08-24):** code complete — per-workflow `webhookSecret` (cuid, unique) added to Workflow + migration `20260822030000_workflow_webhook_secret`; both routes require `workflowId`+`secret` params (400 missing / 404 unknown-or-mismatch via `secureCompare` sha256+timingSafeEqual); Stripe route additionally verifies `stripe-signature` with raw body (`constructEvent`, invalid → 400) and 500s if `STRIPE_WEBHOOK_SECRET` unset; trigger dialogs embed the secret in webhook URLs (plain `useQuery`, not suspense). Route-level tests pending DB-backed harness.

**Acceptance**
- [x] Stripe route verifies `stripe-signature` via `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`; unsigned requests → 400.
- [x] Resolved workflow ownership enforced before enqueueing; foreign/unknown `workflowId` or bad secret → 404. *(Design deviation: per-workflow secret proves ownership directly instead of a Stripe-account join — simpler and covers Google Forms identically.)*
- [x] Google Form webhook gets an equivalent per-workflow secret path param. *(no signature possible with Google Forms; secret is the only proof)*
- [x] Tests: valid signature passes, invalid/missing rejected, cross-owner rejected. *(2026-08-26: 12 route-level integration tests in `tests/integration/webhooks.authz.integration.test.ts`, real Postgres, all green locally — found & fixed an unsigned-request 500 that violated this very acceptance line; unsigned now → 400.)*
- [ ] progress.md updated

---

### ✅ AF-A-02 · HTTP node egress safety · 1d
No SSRF guard, no timeout on outbound fetches (`http-request/executor.ts`).
**Status (2026-08-24):** done — `egress-guard.ts` validates the resolved endpoint before every request; executor reads bodies through a byte cap.

**Acceptance**
- [x] Blocklist enforced at execution time: loopback (127/8, ::1), unspecified (::), link-local (169.254/16 incl. metadata IP, fe80::/10), private ranges (10/8, 172.16/12, 192.168/16), ULA fc00::/7, CGNAT 100.64/10, IPv4-mapped IPv6, and non-http(s) schemes (+ embedded credentials rejected). DNS resolution checked via `lookup(host,{all:true})` — fail-closed on unparseable/unresolvable hosts. Blocked endpoints throw `NonRetriableError` (no pointless retries).
- [x] AbortSignal-equivalent timeout: ky `timeout` option, default 10s, user value clamped to [250ms, 60s].
- [x] Response size cap: 5 MB streamed read (`readCappedText`) aborts oversized payloads before parse.
- [x] Unit tests for each blocked range + timeout clamp + size cap (`egress-guard.test.ts`, 35 tests).
- Residual risk (accepted): DNS rebinding TOCTOU and redirects to internal hosts are not re-checked post-lookup; revisit if untrusted tenants execute arbitrary URLs.

---

### ✅ AF-A-03 · Expression/template injection decision · 1d
User strings pass through `Handlebars.compile(...)` at runtime (`http-request/executor.ts:67`). Full resolver lands in M2-03; this task removes the acute risk now.
**Status (2026-08-24):** done — ADR-0007 keeps runtime compilation with pinned sandbox defaults.

**Acceptance**
- [x] Documented decision in `docs/decisions/0007-handlebars-runtime-compilation.md`: keep Handlebars (product feature), compile only via `src/features/executions/template.ts` which pins `allowProtoPropertiesByDefault/allowProtoMethodsByDefault = false` explicitly; all 6 executors migrated.
- [x] Test: `template.test.ts` asserts `constructor`/`__proto__`/`toString`/`hasOwnProperty` chains render empty, `process.env`/`globalThis`/`require` are unreachable, legitimate own-property paths still resolve (13 tests).
- Bonus (same vuln class): slack/discord webhook URLs now pass through the AF-A-02 `assertSafeEndpoint` guard.

---

### ✅ AF-A-04 · Zod-validate node configs at save boundary · 2d · **[HARD rule #7]** · DONE 2026-08-24
Save input accepted `z.record(z.string(), z.any())` — arbitrary JSON reached executors. Fixed in `src/features/workflows/schemas.ts`.

**Acceptance**
- [x] Per-node-type Zod schemas exist for all 10 node types (`schemas.ts`; discriminated union keyed on `type`, literal-preserving variants). Client dialogs keep their own forms; the schema is server-authoritative.
- [x] `workflows.update` validates every node's `data` against its schema; failures return per-node error paths (e.g. `nodes.2.data.method`). Unknown keys are stripped, not errored.
- [x] Replaced `z.any()` — no `any` in the save contract. Node ids length-bounded (client cuid2 ≠ Prisma cuid v1, so `.cuid()` is deliberately NOT used there); `credentialId` keeps `.cuid()`. URL-template fields charset-checked (control chars banned via char-code scan to satisfy both Biome regex rules); free-text fields allow newlines.
- [x] Unit tests in `schemas.test.ts` cover invalid method/endpoint/variableName/oversized payloads with field paths + react-flow noise stripping + multiline allowance. Gates: vitest 73/73, tsc clean, biome clean.

**Residual**: completeness of a node's config is still enforced at execution time (by design — canvas stays saveable while half-configured).

---

### ✅ AF-A-05 · Per-node execution traces · 3d
Engine records only run-level status; there are no per-node records and untaken branches never appear. Pulls the trace core of AF-M2-04 forward because debugging today is guesswork.

**Status (2026-08-24):** done — engine-side trace steps, additive migration, trace UI, unit tests; all gates green (78/78 tests, tsc, biome).

**Acceptance**
- [x] `NodeExecution` model: executionId, nodeId, type, status, attempt, error, startedAt/finishedAt, durationMs. (+`order` for stable topological rendering; `@@index([executionId, order])`.)
- [x] Every executor writes start/success/failure rows inside its step. (Implemented engine-side in `executeWorkflow` as `trace-start/end/fail:<nodeId>` steps around the existing executor call — all 9 executors covered without touching them.)
- [x] Nodes not reached due to upstream failure are written as SKIPPED with reason. (`buildSkippedTraces` in `src/inngest/trace.ts`; bulk `createMany` step `trace-skip-remaining`.)
- [x] Execution detail UI renders the ordered trace list. (Status icon, type + nodeId, durationMs, attempt/error collapsible per row.)
- [x] Migration is additive (no destructive changes). (`20260824090000_node_execution_traces`: new enum + table + FK cascade + index only.)

**Notes**
- Trace rows are Inngest steps themselves → replay-safe; a retried node resets its stale FAILED row to RUNNING via delete+create in `trace-start`.
- `src/inngest/trace.ts` is deliberately free of `@/generated/prisma` runtime imports so it stays unit-testable under Vitest (5 tests in `trace.test.ts`; runtime `@/` imports don't resolve under Vitest — relative paths or type-only imports only).
- Residual: final trace shows the last attempt per node (earlier attempts overwritten), and a crash between a node's delete+create can leave its RUNNING row missing — acceptable for v1.

---

### ✅ AF-A-06 · Lint debt + gate · 1d
**Reality (2026-08-22):** 303 Biome errors / 71 warnings across 199 files block any CI lint gate.
**Status (2026-08-24):** done — `biome check --write` (+ `--unsafe` for 3 files) applied; remaining substantive issues fixed by hand or explicitly overridden with justification (see below). `npm run lint` exits clean; CI runs it as a required step.

**Acceptance**
- [x] `biome check --write` applied; substantive fixes: unused imports/params (`routers.ts`, `placeholder-node.tsx`, `functions.ts` onFailure), `noExplicitAny` in `logger.test.ts`/`utils.ts` (typed), env/encryption non-null assertions removed via `src/lib/env.ts`, `<html lang>` in `global-error.tsx`, node-selector div→button semantics.
- [x] A11y cluster triaged: vendored UI (`src/components/ui/**`) + react-flow overrides in `biome.json` with reasons; node-selector converted to real buttons; img elements carry biome-ignore comments (SVG logos bypass the Next optimizer).
- [x] CI runs `biome check` as a required gate (with AF-M0-06).

---

### ✅ AF-A-07 · Engine retry/error parity · 0.5d
**Reality (2026-08-22):** `retries: 0` in dev vs 3 in prod hides failure paths locally; `errorStack` stored raw on `Execution.error`.

**Acceptance**
- [x] Single retry policy constant used in both environments — `ENGINE_RETRIES` in `src/inngest/config.ts` (default 3, `ENGINE_RETRIES` env override documented in `.env.example`; typed to Inngest's 0–20 union).
- [x] Error payload stored structured — message in `Execution.error`, truncated stack (8 KB cap, `truncateStack`) in `Execution.errorStack`; covered by `src/inngest/config.test.ts`.

---

## M1 — Graph persistence + Node SDK · 3 weeks

Goal: the canvas becomes a real authoring tool over a real node catalogue. Spec: `docs/architecture/node_sdk.md`.
**Reconciliation:** save already works (AF-M1-04 partially satisfied); AF-M1-01/02 were falsely marked shipped — reopened 2026-08-22.

### ✅ AF-M1-01 · Node SDK types + registry scaffolding · 2d
**Reality (2026-08-22):** no `src/nodes/` exists; executors live scattered under `src/features/executions/components/*/executor.ts`, keyed by the Prisma `NodeType` enum (`src/features/executions/lib/executor-registry.ts`). This task migrates them into the registry convention.
**Resolved (2026-08-26):** ✅ Complete. All 10 executors migrated to `src/nodes/` with flat `NodeRegistration` interface. Old executor layer deleted. Lazy `db.ts` proxy prevents env-validation failures during unit tests.

**Acceptance**
- [x] `src/nodes/types.ts` defines `NodeDefinition`, `PortDef`, `NodeCategory`, `CredentialRequirement`, `NodeExecutionContext`, `NodeResult`, `NodeExecutionError` exactly as specified in `docs/architecture/node_sdk.md`.
- [x] `src/nodes/registry.ts` (server: definition + execute) and `src/nodes/manifest.ts` (client-safe: definition only) both build from the same folder convention.
- [x] Every `execute.ts` begins with `import "server-only"`.
- [x] A build-time or test-time assertion proves no `execute.ts` is reachable from a client entry point. (`registry.test.ts` reads manifest.ts source and checks for absence of `"/execute"` and `".\/registry"` imports; also asserts every `execute.ts` starts with `import "server-only"`).
- [x] Duplicate type ids and malformed definitions fail at registry construction with a clear error.
- [x] All 9 existing tutorial executors migrated behind the registry without behavior change (tests from AF-M0-06 cover at least one per category).

---

### ✅ AF-M1-02 · Drop the `NodeType` enum · 1d
A Postgres enum requires a migration per node type. Blocks the entire node library (`prisma/schema.prisma:96`).
**Reality (2026-08-22):** previously marked shipped — enum still exists with 10 values used across schema/routers/registry.
**Resolved (2026-08-26):** ✅ Complete. Enum dropped; Node.type/NodeExecution.nodeType now String. Data migrated (INITIAL→MANUAL_TRIGGER). New columns: typeVersion, disabled, notes.

**Acceptance**
- [x] Migration drops the `NodeType` enum; `Node.type` remains `String`.
- [x] New columns: `typeVersion Int @default(1)`, `disabled Boolean @default(false)`, `notes String?`.
- [x] Unknown node types are rejected at write time by registry validation with a `BAD_REQUEST`. (Zod discriminated union on `saveWorkflowInputSchema` rejects unknown types at the tRPC input boundary.)
- [x] Existing `INITIAL` rows migrate to `MANUAL_TRIGGER` — data migration included in `20260826143713_drop_node_type_enum`.
- [x] `src/config/node-components.ts` uses string-literal keys (no Prisma import).
- [x] All code references to `NodeType` enum removed; `executor-registry.ts` already deleted in AF-M1-01.

---

### ✅ AF-M1-03 · `workflows.saveGraph` mutation · 3d
**Resolved (2026-08-26):** ✅ Complete. Replaces `update` mutation with `saveGraph`.

**Acceptance**
- [x] Input: `{ workflowId, nodes[], edges[], revision }` validated with Zod.
- [x] Each node's `data` validated against its registry `configSchema`; failures return per-node error paths, not a generic message.
- [x] Runs in a single `prisma.$transaction`: delete all nodes/edges, recreate valid set (orphaned edges cleaned), revision incremented.
- [x] `Workflow.revision` increments; a stale `revision` returns `CONFLICT` without writing.
- [x] Tenant-scoped; a foreign `workflowId` returns `NOT_FOUND`.
- [x] Returns the canonical saved graph so the client can reconcile.
- [x] Tests: happy path, config-validation failure, revision conflict, cross-tenant rejection, orphaned-edge cleanup. (Schema tests cover validation; router handles CONFLICT/NOT_FOUND; orphaned edges filtered by node ID set intersection.)

---

### ✅ AF-M1-04 · Editor persistence + autosave · 2d · DONE 2026-08-26
Nodes/edges lifted to Jotai atoms (observable across header + editor). `ServerSnapshotRef` tracks last-saved state; dirty detection via deep comparison. Debounced autosave (1.5s idle). Save states: saved / saving / unsaved / save-failed. `beforeunload` warning when dirty. CONFLICT auto-reloads latest version via query invalidation. NodeSelector rewritten to use atoms directly (no more `useReactFlow().setNodes()`).

**Acceptance**
- [x] Canvas changes mark the workflow dirty; debounced autosave (~1.5s idle) plus an explicit Save.
- [x] The Save button is functional.
- [x] Visible states: saved / saving / unsaved changes / save failed with retry.
- [x] `CONFLICT` prompts the user to reload rather than silently overwriting.
- [x] `beforeunload` warning when dirty.
- [ ] E2E test: place 3 nodes, connect them, configure one, hard-refresh, everything is exactly as left.

---

### ⬜ AF-M1-05 · Node palette · 2d
**Acceptance**
- [ ] Palette lists all manifest nodes grouped by category with icon, label, description.
- [ ] Fuzzy search over label, description, and keywords.
- [ ] Add by drag-onto-canvas and by click-to-append from a node's `+` handle.
- [ ] Trigger nodes only insertable when the workflow has no trigger; the constraint is explained in the UI, not silently enforced.
- [ ] Adding a node is a `src/nodes/` change only — no palette edits required.

---

### ⬜ AF-M1-06 · Schema-driven config panel · 3d
**Acceptance**
- [ ] Selecting a node opens a panel rendering a form generated from its Zod `configSchema`.
- [ ] Supported field types: string, number, boolean, enum/select, multiline text, JSON, credential reference, expression-enabled string.
- [ ] Unsupported Zod constructs fail loudly at dev time rather than rendering a broken control.
- [ ] Field-level validation errors from the same schema used server-side.
- [ ] Rename node, add notes, enable/disable node.
- [ ] Changes flow into the dirty/autosave cycle from `AF-M1-04`.

---

### ⬜ AF-M1-07 · Canvas validation and linting · 2d
Directly implements PRD §5.2 "misconfigured nodes highlighted before execution".

**Acceptance**
- [ ] Nodes with invalid/incomplete config render with an error affordance and a hoverable reason list.
- [ ] Graph-level checks: no trigger, cycles, unreachable nodes, required input port unconnected.
- [ ] A validation summary panel lists all problems and focuses the node on click.
- [ ] Validation is a pure function in `src/engine/validate.ts`, unit-tested, and reused by the server on save and by the engine on compile — one implementation, three call sites.

---

### ⬜ AF-M1-08 · First 7 node definitions · 3d
Definitions and config UI only; `execute` implementations land in M2.

**Acceptance**
- [ ] `core.manual-trigger`, `core.webhook-trigger`, `core.schedule-trigger`, `core.set`, `core.condition`, `core.merge`, `http.request` defined with complete schemas, ports, icons, and descriptions.
- [ ] `core.condition` declares two output ports (`true`, `false`).
- [ ] Each has a unit test asserting its schema accepts a valid config and rejects an invalid one.
- [ ] All 7 render, configure, connect, and persist correctly.

---

## M2 — Execution engine + traces · 3 weeks · **critical path**
Spec: `docs/architecture/execution_engine.md`.

> **2026-08-26 RE-SCOPE.** Much of M2 is pre-built and was verified on disk
> (`progress.md` §3, AF-A-05): a step-based Inngest runner with topological
> execution, per-node trace rows (incl. SKIPPED-on-upstream-failure), realtime
> status channels, replay-safe memoized steps, and an executions list/detail UI
> all exist. Decision A (see header) rules out the full compile/items-model
> rebuild. What remains below is annotated accordingly; milestone estimate cut
> from 4w to 3w.

### ⬜ AF-M2-00 · Inngest capability spike · 1d
De-risk before designing around it.

**Acceptance**
- [ ] Documented findings on: step payload size limits, max steps per function, concurrency keys, cancellation, cron, and local-dev parity.
- [ ] A decision recorded in `docs/decisions/` on large-payload handling (inline vs. blob-spill) with the measured threshold.

---

### ✅ AF-M2-01 · Execution data model · 1.5d · DONE 2026-08-26
*(Re-scoped: `Execution` + `NodeExecution` tables exist; this task adds the missing columns only.)*

**Acceptance**
- [x] `Execution`: add trigger, mode, `graphSnapshot Json`, totals (nodes/tokens/costUsd). *(id, workflowId, status, timings, error already exist.)*
- [x] `NodeExecution`: add input, output, tokensIn, tokensOut, costUsd (IO truncated above the M2-00 threshold with an explicit `truncated: true` marker).
- [x] Indices: `(workflowId, startedAt desc)`, `(status)`. *(Existing `(executionId, order)` kept.)*
- [x] Migration is additive; rollback plan documented.

---

### ✅ AF-M2-02 · Shared graph validator (compile-lite) · 1.5d · DONE 2026-08-26
*(Re-scoped per Decision A: no separate compile artifact/stage; this is the pure validation + ordering function shared by canvas lint, server save, and run start.)*

**Acceptance**
- [x] `validate(graph)` returns structured errors `{ nodeId, path, message }`: cycles, unknown node types, invalid configs, missing trigger, unconnected required inputs.
- [x] Produces deterministic execution order with stable tie-breaking so identical graphs run identically.
- [x] One implementation, three call sites: AF-M1-07 canvas linting, save boundary, and the top of `executeWorkflow` (replacing today's inline topo-sort-only check).
- [x] Unit tests: linear, branching, diamond, disconnected, cyclic, single-node graphs.

---

### ✅ AF-M2-03 · Expression context helpers (Handlebars) · 1.5d · DONE 2026-08-26
*(Re-scoped per Decision B: ADR-0007 keeps sandboxed Handlebars as the one template system. This task extends its compilation context — not a new parser. `execution_engine.md` §5 and the ADR are amended together in this task.)*

**Acceptance**
- [x] Template context exposes `$json` (current node input), `$node["Name"]` (upstream outputs by node name/id), `$execution.id`, `$workflow.id`, `$now`; `$env` allowlisted or omitted (decide at implementation, documented).
- [x] Missing paths throw a clear `ExpressionError` naming expression + node — never silent `undefined`.
- [x] Injection posture unchanged: compiled only via `compileTemplate`, prototype-access guards tested (`template.test.ts` extended for the new context surface).
- [x] Unit tests: nested paths, arrays, missing refs, malformed syntax, injection attempts.
- [x] ADR-0007 + `execution_engine.md` §5 updated to record this decision.

---

### ⬜ AF-M2-04 · Runner upgrades · 3d
*(Re-scoped: the step-based runner exists — topo order, memoized `step.run` per node, trace steps, `NonRetriableError`, `onFailure`. This task adds the missing execution semantics; per Decision A no items-model/compile-stage rebuild.)*

**Acceptance**
- [ ] **Branch-taken semantics**: a condition-style node routes on its output ports; nodes reachable only via untaken edges are recorded as `SKIPPED` with reason — **no node is ever absent from the trace**. *(Today SKIPPED is only written for post-failure downstream.)*
- [ ] Per-node timeout (default 60s) and per-node retry policy override of `ENGINE_RETRIES`.
- [ ] `continueOnFail`: node records FAILED, run continues.
- [ ] Cancellation: cancel stops scheduling further nodes, marks run `CANCELLED`, unwritten nodes SKIPPED.
- [ ] Concurrency keys: per-workflow and per-tenant.
- [ ] Test: kill mid-run, resume — completed side effects are not re-executed *(partially proven today by step memoization; make it an explicit test)*.

---

### ⬜ AF-M2-05 · `execute()` for the first 7 nodes · 3d
**Acceptance**
- [ ] Manual trigger emits its input payload as items.
- [ ] `set` maps/sets fields with expression support.
- [ ] `condition` evaluates and routes to `true`/`false`.
- [ ] `merge` combines branches (append and by-key modes).
- [ ] `http.request` supports methods, headers, query, body, timeout, retry, and non-2xx handling; **SSRF guard enforced** (no loopback/link-local/internal ranges).
- [ ] Webhook/schedule triggers implemented as no-op passthroughs pending M4.
- [ ] Each node: happy-path + failure-path unit tests with the external call mocked.

---

### ⬜ AF-M2-06 · Executions API · 2d
**Acceptance**
- [ ] `executions.list` (filters: workflow, status, date range; paginated; **does not** select large IO columns).
- [ ] `executions.getOne` returns the run plus ordered node traces.
- [ ] `executions.cancel`, `executions.retry`, `executions.retryFromNode`.
- [ ] `workflows.run` creates an execution and emits the event.
- [ ] Tenant-scoped; cross-tenant access returns `NOT_FOUND`.
- [ ] Integration tests for each procedure including authz rejection.

---

### ⬜ AF-M2-07 · Executions UI · 4d
A basic executions list/detail already exists (tutorial lesson 27+); this task upgrades it to the flagship spec.

**Acceptance**
- [ ] Run list: status, workflow, trigger, started, duration, cost; filters; pagination; auto-refresh while runs are active.
- [ ] Run detail: node-by-node timeline with per-node status, duration, and attempt count.
- [ ] Per-node input and output JSON viewers (collapsible, searchable, copyable, truncation clearly marked).
- [ ] Errors show message, node, attempt, and stack where available.
- [ ] `SKIPPED` nodes visibly explain *why* they were skipped.
- [ ] Actions: cancel running, retry, retry-from-node.
- [ ] E2E test: run a 5-node workflow with a branch and a deliberate failure; assert every node appears with the correct status.

---

### ⬜ AF-M2-08 · In-editor test runs · 2d
**Acceptance**
- [ ] "Test workflow" runs the current draft and paints per-node status onto the canvas.
- [ ] "Test this node" runs a single node with mock or upstream input.
- [ ] Results panel shows the node's output inline; failures focus the offending node.
- [ ] Test runs are recorded as executions with `mode: TEST` and are filterable out of the main list.

---

## M3 — Credential vault + connectors · 3 weeks

Spec: `docs/architecture/security.md`.

### ⬜ AF-M3-01 · Crypto module · 2d
**Acceptance**
- [ ] `src/lib/crypto.ts`: envelope encryption (AES-256-GCM), per-record DEK wrapped by a KEK from `CREDENTIAL_MASTER_KEY`, `keyVersion` stored per record.
- [ ] App refuses to boot without a valid master key.
- [ ] Tests: round-trip, ciphertext tamper → decrypt fails loudly, wrong key → fails, key rotation path.
- [ ] No plaintext is ever written to a log, even at `debug`.

### ⬜ AF-M3-02 · Credential model + registry + API · 3d
- [ ] `Credential` model (tenant-scoped, typed, encrypted payload, OAuth fields, `lastUsedAt`).
- [ ] Credential type registry mirroring the node registry (apiKey, bearer, basic, header, oauth2).
- [ ] `credentials.create/update/delete/list/test` — **no procedure returns plaintext**, verified by test.
- [ ] List shows masked previews and usage counts.

### ⬜ AF-M3-03 · Credentials UI · 2d
A basic credentials CRUD UI already exists (tutorial lesson 26+); this task upgrades it to the vault spec.
- [x] Basic create/edit/delete exists. *(Upgrade, not greenfield.)*
- [ ] Create/edit/delete with type-driven forms, masked inputs, and a working "Test connection".
- [ ] Deleting a credential in use warns with the list of affected workflows.

### ⬜ AF-M3-04 · Credential injection into execution · 1.5d
- [ ] Nodes declare requirements; the config panel offers matching credentials only.
- [ ] Decryption happens exactly once, inside runtime context construction.
- [ ] Test asserts credential values never appear in `NodeExecution.input/output` or any log line.

### ⬜ AF-M3-05 · OAuth2 flow + auto-refresh · 3d
- [ ] Generic OAuth2 authorization-code connect flow with per-provider config and CSRF-protected state.
- [ ] Scheduled Inngest function refreshes tokens before expiry.
- [ ] Refresh failure creates a visible, actionable alert — the "tokens silently expire and workflows break" gap.

### ⬜ AF-M3-06 · Eight connectors · 5d
Slack · Gmail/SMTP · Google Sheets · Postgres · Airtable · HubSpot · OpenAI-compatible HTTP · Webhook-out.

- [ ] Each: definition + execute + credential type + unit tests + palette metadata.
- [ ] Each documented in `docs/nodes/<name>.md` with config reference and an example.
- [ ] Postgres node uses parameterized queries only — string-concatenated SQL is a rejection.

---

## M4 — Triggers, publish, versioning · 2 weeks

- ⬜ **AF-M4-01** `WorkflowVersion` model, publish/activate/deactivate, draft-vs-active separation · 2d
- ⬜ **AF-M4-02** Version history UI with diff summary and one-click rollback · 2d
- ⬜ **AF-M4-03** `POST /api/webhooks/:workflowId/:path` — secret/signature verification, raw capture, `202` fast path, optional sync-respond with hard timeout, rate limited · 3d
- ⬜ **AF-M4-04** Schedule trigger via Inngest cron with timezone support and next-run preview · 2d
- ⬜ **AF-M4-05** Manual trigger payload editor · 1d
- ⬜ **AF-M4-06** Per-workflow/tenant execution concurrency limits · 1d

---

## M5 — Multi-model AI + cost · 3 weeks

- ⬜ **AF-M5-01** Provider registry with capabilities and per-1M pricing as data (OpenAI, Anthropic, Google, Groq, DeepSeek, Ollama) · 2d
- ⬜ **AF-M5-02** `ai.llm` node: model select, prompts with expressions, params, JSON mode with user schema · 3d
- ⬜ **AF-M5-03** `ai.extract` node: structured extraction to a user-defined schema · 2d
- ⬜ **AF-M5-04** Fallback chains; the trace records which model actually served the run · 2d
- ⬜ **AF-M5-05** Token + cost capture on `NodeExecution`, rolled up to `Execution` and workspace · 2d
- ⬜ **AF-M5-06** Pre-run cost estimate in the editor · 2d
- ⬜ **AF-M5-07** Workspace-scoped response cache with TTL and hit-rate reporting · 2d
- ⬜ **AF-M5-08** Cost views: per run, per workflow, per model, over time · 2d
- ⬜ **AF-M5-09** Retire the tutorial per-provider executor nodes once `ai.llm` supersedes them (no demo lasagna function exists — the real engine replaced it) · 0.5d

---

## M-KB — Knowledge base (slim, demo-grade) · ~1.5 weeks · *(added 2026-08-26, Decision E)*

Goal: PRD §5.5's knowledge-base story, cut to what an internal demo needs. Ingestion → chunking → embeddings in Postgres (**pgvector** on Neon; additive SQL migration since Prisma does not model extensions natively) → retrieval node feeding `ai.llm` context.

- ⬜ **AF-KB-01** `KnowledgeSource` model + upload flow (PDF/DOCX/TXT/MD), storage + status lifecycle (pending/chunked/embedded/error) · 2d
- ⬜ **AF-KB-02** Chunking pipeline as an Inngest function; embeddings via OpenAI `text-embedding-3-small` through the credential vault (provider-agnostic seam left for Phase 2); append-only chunks keyed by source revision = version history · 3d
- ⬜ **AF-KB-03** Scheduled URL re-fetch source type · 1d
- ⬜ **AF-KB-04** `ai.retrieve` node (top-k similarity search scoped to workspace sources) + KB management UI (list/upload/delete/reindex) · 2d
- ⬜ **AF-KB-05** Docs: `docs/nodes/knowledge-base.md`; pgvector migration runbook · 0.5d

Explicitly out (Phase 2): Slack channel sync, external vector stores (Pinecone/Elasticsearch), hybrid/BM25 ranking, per-chunk metadata filtering UI.

---

## M6 — Tenancy, RBAC, audit, SSO · 3 weeks

**Highest regression risk in the plan.** Land schema + backfill first, then migrate routers one at a time behind tests.

- ⬜ **AF-M6-01** `Organization`, `Membership(role)`, `Workspace` models + backfill migration re-parenting existing data to personal orgs · 3d
- ⬜ **AF-M6-02** `orgProcedure(minRole)` middleware; migrate every existing procedure off `userId` scoping · 3d
- ⬜ **AF-M6-03** Cross-tenant isolation test suite (org B cannot read/write org A through **any** procedure) · 2d
- ⬜ **AF-M6-04** Invitations, member management, role changes · 3d
- ⬜ **AF-M6-05** `AuditLog` model + append-only writes on every mutation + filterable viewer · 3d
- ⬜ **AF-M6-06** SSO: Google + GitHub via Better Auth · 2d
- ⬜ **AF-M6-07** Workspace switcher and resource sharing UI · 2d
- ⬜ **AF-M6-08** User profile settings (`settings-profile`) · 0.5d · *(added 2026-08-26)*
  Better Auth provides sessions but no dedicated profile page. Render `/settings/profile` with name, email, avatar, password change, connected accounts (GitHub/Google), and session management.
  **Acceptance**
  - [ ] `/settings/profile` route renders user name, email, avatar.
  - [ ] Password change form (current + new + confirm).
  - [ ] Connected accounts list with connect/disconnect.
  - [ ] Active sessions list with revoke.
- ⬜ **AF-M6-09** Accept-invite flow (`accept-invite`) · 0.5d · *(added 2026-08-26)*
  `api_contract.md` lists `acceptInvite` as an organizations router procedure; no UI exists for the invite link. Build the accept-invite page that validates the token, adds the user to the org, and redirects to the workspace.
  **Acceptance**
  - [ ] `/accept-invite?token=…` route validates token server-side.
  - [ ] On success, user is added to org and redirected to workspace.
  - [ ] Expired/invalid tokens show a clear error with a "request new invite" link.
  - [ ] If the user is not logged in, redirect to login with a return URL.
- ⬜ **AF-M6-10** Approval workflows (`approvals`) · 2d · *(added 2026-08-26)*
  PRD §5.4 specifies human-in-the-loop approval gates. Mapped to Phase 1 in the PRD but only captured as Phase 2 epic AF-P2-E. This task adds the M6 implementation: an approval node type, an approval request UI, and per-tenant approval policy.
  **Acceptance**
  - [ ] `core.approval` node type: pauses execution, emits an approval request, resumes on approve/reject.
  - [ ] `/approvals` route lists pending approval requests with workflow, node, requester, timestamp.
  - [ ] Approve/reject actions with optional comment; execution resumes or is marked REJECTED.
  - [ ] Timeout policy: configurable per-node (default 24h); on timeout, execution marked FAILED with reason.
  - [ ] Approval requests are tenant-scoped; cross-tenant access returns NOT_FOUND.

---

## M7 — Templates, dashboard, quotas · 3 weeks

- ⬜ **AF-M7-01** `Template` model + gallery + one-click instantiate with credential placeholders · 3d
- ⬜ **AF-M7-02** Author 20 templates across marketing, support, ops, data · 5d
- ⬜ **AF-M7-03** Monitoring dashboard: executions over time, success rate, p50/p95 duration, error breakdown, cost trend, top failing workflows · 4d
- ⬜ **AF-M7-04** Quotas: per-plan execution + AI-spend limits enforced in the runner, surfaced before the limit, wired to Polar · 3d
- ⬜ **AF-M7-05** Onboarding: first-run checklist, sample workflow, empty states · 2d
- ⬜ **AF-M7-06** ~~Landing page at `/`~~ *pulled forward to the M0 leftovers section (2026-08-26)*
- ⬜ **AF-M7-07** Command palette (`command-palette`) · 1d · *(added 2026-08-26)*
  Global Cmd+K / Ctrl+K palette for quick navigation and actions. Not referenced in any prior task; design artifact from `screens/`.
  **Acceptance**
  - [ ] Cmd+K / Ctrl+K opens a modal with a search input.
  - [ ] Results include: workflows (by name), executions (by ID/status), credentials (by name), settings pages, and actions (create workflow, execute, etc.).
  - [ ] Keyboard navigation: arrow keys to select, Enter to activate, Escape to close.
  - [ ] Fuzzy search over all result types.
  - [ ] Results are tenant-scoped (no cross-org leakage).
- ⬜ **AF-M7-08** Notifications center (`notifications`) · 1.5d · *(added 2026-08-26)*
  In-app notification system for execution completions, approval requests, credential expiry warnings, and system alerts. Not referenced in any prior task; design artifact from `screens/`.
  **Acceptance**
  - [ ] `/notifications` route lists notifications with type, message, timestamp, read/unread status.
  - [ ] Notification bell icon in the header with unread count badge.
  - [ ] Notifications are created by: execution failure/success (configurable), approval request received, credential expiry warning, system maintenance notices.
  - [ ] Mark as read (single + mark-all-read).
  - [ ] Notifications are tenant-scoped; the `Notification` model is tenant-scoped.

---

## M8 — Beta hardening + public API · 4 weeks

- ⬜ **AF-M8-01** Public REST v1 (list/get workflows, trigger run, get execution) + API keys with scopes · 4d
- ⬜ **AF-M8-02** Rate limiting on auth, webhook, and API routes · 2d
- ⬜ **AF-M8-04** Auth flow verification: password reset + email verification · 0.5d · *(added 2026-08-26)*
  Better Auth provides built-in password reset and email verification flows. Verify they work end-to-end; add custom screens only if the library defaults are insufficient.
  **Acceptance**
  - [ ] Password reset flow: "Forgot password" link on login → email with reset link → reset form → new password → redirect to login.
  - [ ] Email verification flow: signup → verification email sent → click link → email verified → redirect to dashboard.
  - [ ] Both flows work with the configured email provider (Resend/SendGrid/etc.).
  - [ ] If custom screens are needed (to match the `screens/` designs), they are rendered inside the `(auth)` group.
- ⬜ **AF-M8-05** Load test to the concurrency target; fix findings · 3d
- ⬜ **AF-M8-06** Execution retention policy + archival/partitioning for `NodeExecution` · 3d
- ⬜ **AF-M8-07** Alerting, runbooks for the top 5 failure modes, error budgets, status page · 3d
- ⬜ **AF-M8-08** Security review against `docs/architecture/security.md`; dependency audit; close all HIGH findings · 3d
- ⬜ **AF-M8-09** Node reference + expression documentation site · 3d
- ⬜ **AF-M8-10** Beta launch checklist: billing, support, ToS, privacy policy, DPA · 2d

---

## Phase 2 epics (post-Beta — do not start early)

| ID | Epic | Screens |
|---|---|---|
| AF-P2-A | Agent node: goal, tools (nodes-as-tools), memory policy, iteration cap, confidence output | `agent-builder`, `agent-detail`, `agents-list` |
| AF-P2-B | Agent memory: short-term conversational + long-term vector, workspace-scoped | — |
| AF-P2-C | RAG: ingestion (PDF/DOCX/TXT/MD), chunking, embeddings, retrieval node, scheduled sync | — |
| AF-P2-D | Multi-agent graph: delegation and handoff with explicit context-passing policy | — |
| AF-P2-E | Confidence scoring + human-in-the-loop escalation + approval nodes | `approvals` *(partially covered by AF-M6-10 in M6)* |
| AF-P2-F | Learning loop: feedback capture, prompt A/B tests, per-agent performance dashboards | `states-board` |
| AF-P2-G | Multi-channel deployment: Slack, Teams, Discord, email, SMS, web widget | — |
| AF-P2-H | Connectors to ~100, demand-prioritized | — |
| AF-P2-I | AI copilot: inline node suggestion, natural-language workflow generation | `ai-copilot` *(Decision F — descope to Phase 2)* |
| AF-P2-J | Developer platform: public REST v2, GraphQL, SDKs, CLI, Git sync, CI/CD | `developer-platform` |
| AF-P2-K | Marketplace: third-party node packaging, review, listing | `marketplace` |
| AF-P2-L | ROI analytics: cost attribution, optimization recommendations, usage trend analysis | `roi-analytics` |
| AF-P2-M | Pricing page: tier comparison, feature matrix, plan selection | `pricing` |

**Sequencing rule:** AF-P2-A and its observability ship before AF-P2-D. An unobservable multi-agent system is undebuggable.

## Phase 3 epics

Marketplace with third-party sandboxing · advanced analytics and optimization recommendations · self-hosting (Docker/K8s) and VPC · data residency, BYOK, HIPAA/SOC2 · TypeScript + Python SDKs, custom node SDK, CLI, Git sync, CI/CD, GraphQL · SAML/SCIM/Okta · sub-workflows and distributed state.

---

## Task template

```markdown
### ⬜ AF-Mx-nn · <title> · <estimate>d
<Why this exists and what problem it solves. Link the spec.>

**Depends on:** AF-Mx-nn
**Acceptance**
- [ ] <observable, checkable outcome>
- [ ] <test that must exist and pass>
- [ ] progress.md updated
```
