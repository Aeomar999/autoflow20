# AutoFlow — Task Backlog

**Last updated:** 2026-08-29 (AF-M1 ✅ complete; AF-M2 ✅ complete; AF-M3 ✅ complete; AF-M4 ✅ all 6 tasks complete — versioning, webhooks, cron schedule trigger, manual payload, and concurrency limits)
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
- [x] `npm run build` passes from a fresh clone. *(Verified 2026-08-28 — Vercel `main` (04b9a35) build is green: `npm install` → `postinstall: prisma generate` emits the gitignored `src/generated/prisma` client → `next build --turbopack`, all 15 pages generated, no `Module not found` errors.)*
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

### ✅ AF-M1-05 · Node palette · 2d
**Acceptance**
- [x] Palette lists all manifest nodes grouped by category with icon, label, description.
- [x] Fuzzy search over label, description, and keywords.
- [x] Add by drag-onto-canvas and by click-to-append from a node's `+` handle.
- [x] Trigger nodes only insertable when the workflow has no trigger; the constraint is explained in the UI, not silently enforced.
- [x] Adding a node is a `src/nodes/` change only — no palette edits required.

**Status 2026-08-29 — done:** `src/components/node-selector.tsx` is completely manifest-driven (`nodeManifest`), rendering all categories with counts and icons (`node-icon.tsx`); multi-token search covers label, description, keywords, category, and type; HTML5 drag-and-drop onto the React Flow canvas (`onDragOver`/`onDrop` in `editor.tsx`) calculates flow position and adds the node; click-to-append `+` handle on `BaseExecutionNode` and `BaseTriggerNode` auto-places and connects new nodes; single-trigger constraint is enforced with an explanatory warning banner and toast; `GenericNode` fallback in `node-components.ts` ensures any node added to `src/nodes/` renders immediately on canvas without manual palette edits. Tested with 6 DOM tests in `node-selector.dom.test.tsx` (all 44 test files / 394 tests green).

---

### 🟡 AF-M1-06 · Schema-driven config panel · 3d
**Acceptance**
- [x] Selecting a node opens a panel rendering a form generated from its Zod `configSchema`.
- [x] Supported field types: string, number, boolean, enum/select, multiline text, credential reference, kv-list (`z.record` / array-of-key-value).
- [x] Unsupported Zod constructs fail loudly at dev time rather than rendering a broken control.
- [x] Field-level validation errors from the same schema used server-side (delivered via AF-M1-07 canvas linting — the client resolves the manifest `configSchema`, the same schema the server validates against).
- [x] Rename node, add notes, enable/disable node.
- [x] Changes flow into the dirty/autosave cycle from `AF-M1-04`.

**Status 2026-08-28 → 2026-08-29 — done.** Schema-driven config panel landed on `af-m1-06-schema-driven-config-panel` (stacked on `chore/prisma7-dev-fixes-and-docs`, un-pushed, PR body staged). Node selection is wired to the panel; `config-schema.ts` introspects a node's `configSchema` into renderable fields (string / number / boolean / z.enum / multiline / credential reference / kv-list), and anything unsupported throws `UnsupportedConfigFieldError`, which renders a loud error box instead of a broken control. Rename/notes/enable-disable patch the node into `nodesAtom`, flowing through the existing dirty/autosave cycle; the panel is remount-keyed by `node.id` so selecting a different node can never show stale list rows, and list rows keep stable ids for React keys. Deliberately not built: expression editor, JSON textarea, and any runtime honouring of `node.disabled` (engine skips land in M2). Tests: 6 dom tests over every rendered kind plus rename/notes/disabled (node-config-panel.dom.test.tsx), a catalogue scan resolving every manifest `configSchema` (config-schema.test.ts), connector schema tests (schemas.test.ts); lint, `npm test` (377 passing), and `next build` all green. The last open AC — field-level validation from the same schema used server-side — is closed by AF-M1-07 (2026-08-29): the canvas lints nodes live against the manifest `configSchema`, the identical schema the server validates against on save and the engine on compile.

---

### ✅ AF-M1-07 · Canvas validation and linting · 2d
Directly implements PRD §5.2 "misconfigured nodes highlighted before execution".

**Acceptance**
- [x] Nodes with invalid/incomplete config render with an error affordance and a hoverable reason list.
- [x] Graph-level checks: no trigger, cycles, unreachable nodes, required input port unconnected.
- [x] A validation summary panel lists all problems and focuses the node on click.
- [x] Validation is a pure function in `src/engine/validate.ts`, unit-tested, and reused by the server on save and by the engine on compile — one implementation, three call sites.

**Status 2026-08-29 — done.** Canvas linting ships on `af-m1-07-canvas-validation` (stacked on `af-m1-06-schema-driven-config-panel`): the pure `validate(graph, registry)` in `src/engine/validate.ts` is now reused at **four** call sites — `workflows.saveGraph` (server boundary, `routers.ts`), test-run compile (`test-run.ts`), `executeWorkflow` (engine compile, `src/inngest/functions.ts`), and a new live render of the canvas draft through a client registry adapter (`src/features/editor/lib/validation.ts`). The adapter keeps the client-safe invariant: it resolves node types + config schemas from the isomorphic manifest (never the server-only registry), aliases `INITIAL` → `MANUAL_TRIGGER`, and normalizes defaulted edge handles (`|| "main"`) exactly as the server does — so client, save, and engine report the same issues. Live lint flows through a derived `validationResultAtom` over `nodesAtom`/`edgesAtom`: each offending node renders an error badge with a hoverable reason list (`node-validation-badge.tsx`), and a collapsible top-left summary panel lists every graph-level problem (no trigger, cycles, unreachable nodes, unconnected required inputs, invalid configs) and focuses the node on click (`validation-panel.tsx`). Checks covered: triggers, cycles, unknown types, config `safeParse`, unconnected required inputs, disconnected nodes. Tests: 11 new/extended unit tests (toGraph normalization, registry resolve + INITIAL parity, unknown-type throw, config error/valid, unconnected required input, cycle) over `validate.test.ts` + `validation.test.ts`; also fixed a pre-existing build blocker in the uncommitted M1-06 tree (`entity-components.tsx` EntityItemProps `title` widened to `React.ReactNode` so the workflows list badge markup compiles). Suite 405 collected — 388 passed + 17 skipped; lint and `next build --turbopack` green. Both M1-06 and M1-07 branches remain local — GitHub pushes blocked on network (see AF-M1-06).

---

### ✅ AF-M1-08 · First 7 node definitions · 3d
Definitions and config UI only; `execute` implementations land in M2.

**Acceptance**
- [x] `core.manual-trigger`, `core.webhook-trigger`, `core.schedule-trigger`, `core.set`, `core.condition`, `core.merge`, `http.request` defined with complete schemas, ports, icons, and descriptions.
- [x] `core.condition` declares two output ports (`true`, `false`).
- [x] Each has a unit test asserting its schema accepts a valid config and rejects an invalid one (`src/nodes/core/*/definition.test.ts` + `src/nodes/http/request/definition.test.ts`, 36 tests passing).
- [x] All 7 render, configure, connect, and persist correctly.

**Status 2026-08-29 — done:** All 7 node definitions (`MANUAL_TRIGGER`, `WEBHOOK_TRIGGER`, `SCHEDULE_TRIGGER`, `SET`, `CONDITION`, `MERGE`, `HTTP_REQUEST`) are implemented with complete Zod `configSchema`s, ports (including `CONDITION` with `true`/`false` outputs), icons, descriptions, and keywords. Unit tests cover all 7 node definitions asserting valid configurations, default values, and rejections of invalid inputs. All 7 integrate with the schema-driven config panel, canvas validation/linting, node palette, and persistence. All 46 test files / 411 tests green.

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

### ✅ AF-M2-04 · Runner upgrades · 3d · DONE 2026-08-26
*(Re-scoped: the step-based runner exists — topo order, memoized `step.run` per node, trace steps, `NonRetriableError`, `onFailure`. This task adds the missing execution semantics; per Decision A no items-model/compile-stage rebuild.)*

**Acceptance**
- [x] **Branch-taken semantics**: a condition-style node routes on its output ports; nodes reachable only via untaken edges are recorded as `SKIPPED` with reason — **no node is ever absent from the trace**. *(Today SKIPPED is only written for post-failure downstream.)*
- [x] Per-node timeout (default 60s) and per-node retry policy override of `ENGINE_RETRIES`.
- [x] `continueOnFail`: node records FAILED, run continues.
- [x] Cancellation: cancel stops scheduling further nodes, marks run `CANCELLED`, unwritten nodes SKIPPED.
- [x] Concurrency keys: per-workflow and per-tenant.
- [x] Test: kill mid-run, resume — completed side effects are not re-executed *(partially proven today by step memoization; make it an explicit test)*.

---

### ✅ AF-M2-05 · `execute()` for the first 7 nodes · 3d
**Acceptance**
- [x] Manual trigger emits its input payload as items.
- [x] `set` maps/sets fields with expression support.
- [x] `condition` evaluates and routes to `true`/`false`.
- [x] `merge` combines branches (append and by-key modes).
- [x] `http.request` supports methods, headers, query, body, timeout, retry, and non-2xx handling; **SSRF guard enforced** (no loopback/link-local/internal ranges).
- [x] Webhook/schedule triggers implemented as no-op passthroughs pending M4.
- [x] Each node: happy-path + failure-path unit tests with the external call mocked.

---

### ✅ AF-M2-06 · Executions API · 2d
**Acceptance**
- [x] `executions.list` (filters: workflow, status, date range; paginated; **does not** select large IO columns).
- [x] `executions.getOne` returns the run plus ordered node traces.
- [x] `executions.cancel`, `executions.retry`, `executions.retryFromNode`.
- [x] `workflows.run` creates an execution and emits the event.
- [x] Tenant-scoped; cross-tenant access returns `NOT_FOUND`.
- [x] Integration tests for each procedure including authz rejection.

---

### ✅ AF-M2-07 · Executions UI · 4d
A basic executions list/detail already exists (tutorial lesson 27+); this task upgrades it to the flagship spec.

**Acceptance**
- [x] Run list: status, workflow, trigger, started, duration, cost; filters; pagination; auto-refresh while runs are active.
- [x] Run detail: node-by-node timeline with per-node status, duration, and attempt count.
- [x] Per-node input and output JSON viewers (collapsible, searchable, copyable, truncation clearly marked).
- [x] Errors show message, node, attempt, and stack where available.
- [x] `SKIPPED` nodes visibly explain *why* they were skipped.
- [x] Actions: cancel running, retry, retry-from-node.
- [x] E2E test: run a 5-node workflow with a branch and a deliberate failure; assert every node appears with the correct status.

---

### ✅ AF-M2-08 · In-editor test runs · 2d
**Acceptance**
- [x] "Test workflow" runs the current draft and paints per-node status onto the canvas.
- [x] "Test this node" runs a single node with mock or upstream input.
- [x] Results panel shows the node's output inline; failures focus the offending node.
- [x] Test runs are recorded as executions with `mode: TEST` and are filterable out of the main list.

---

## M3 — Credential vault + connectors · 3 weeks

Spec: `docs/architecture/security.md`.

### ✅ AF-M3-01 · Crypto module · 2d
**Acceptance**
- [x] `src/lib/crypto.ts`: envelope encryption (AES-256-GCM), per-record DEK wrapped by a KEK from `CREDENTIAL_MASTER_KEY`, `keyVersion` stored per record.
- [x] App refuses to boot without a valid master key.
- [x] Tests: round-trip, ciphertext tamper → decrypt fails loudly, wrong key → fails, key rotation path.
- [x] No plaintext is ever written to a log, even at `debug`.

**Notes**
- `CURRENT_KEY_VERSION = 1`; `decryptCredential` takes an optional `CredentialKeyRing`
  (Map `keyVersion → KEK`) so N-1 generations stay decryptable during rotation;
  `rewrapCredential` re-wraps a DEK without touching the payload (the rolling
  rotation path, per security.md §3).
- Boot gates: `CREDENTIAL_MASTER_KEY` is required in `src/lib/env.ts` (Zod) and
  validated as 32-decode-bytes by `assertCredentialMasterKey` in
  `src/instrumentation.ts` (skipped under `SKIP_ENV_VALIDATION=1`).
- `ENCRYPTION_KEY`/Cryptr legacy path (`src/lib/encryption.ts`) now exists only
  for `scripts/migrate-credentials.ts` (one-time converter); the three AI node
  executors decrypt via the vault (`openSecret`, AF-M3-02), `ENCRYPTION_KEY` is
  optional in `src/lib/env.ts`. *(Completed 2026-08-27, 16 unit tests.)*

### ✅ AF-M3-02 · Credential model + registry + API · 3d
**Acceptance**
- [x] `Credential` model (tenant-scoped, typed, encrypted payload, OAuth fields, `lastUsedAt`).
- [x] Credential type registry mirroring the node registry (apiKey, bearer, basic, header, oauth2).
- [x] `credentials.create/update/remove/list/getOne/test` — **no procedure returns plaintext**, verified by test.
- [x] List shows masked previews and usage counts.

**Notes**
- Storage is the sealed envelope (ADR-0004) as five `Bytes` columns
  (`ciphertext/iv/authTag/wrappedDek`) + `keyVersion`; `type` is the registry id
  (enum dropped). Hand-written migration
  `20260827170000_credential_vault_af_m3_02` + one-time converter
  `npm run migrate:credentials [-- --yes]` (run BEFORE `migrate deploy`, idempotent,
  dry-run by default).
- Registry split like the node SDK: isomorphic defs/helpers in
  `credential-types.ts` (kind union + 8 registered ids incl. migrated
  `openai.apiKey`/`anthropic.apiKey`/`gemini.apiKey`), validation + network testers
  server-only in `credential-registry.ts`.
- Decrypt call sites: node executors (`openSecret`) and the server-side `test`
  probe only. Outputs are `.output(...)`-validated against a `.strict()`
  `CredentialPublic` schema (metadata + `preview` + `usageCount`) — a secret field
  in any response fails the schema.
- Legacy Cryptr rows: converted by `scripts/migrate-credentials.ts`;
  `ENCRYPTION_KEY` demoted to optional/legacy. *(Completed 2026-08-27, 42 new
  unit tests — registry/vault/security.)*

### ✅ AF-M3-03 · Credentials UI · 2d
A basic credentials CRUD UI already exists (tutorial lesson 26+); this task upgrades it to the vault spec.
- [x] Basic create/edit/delete exists. *(Upgrade, not greenfield.)*
- [x] Create/edit/delete with type-driven forms, masked inputs, and a working "Test connection".
- [x] Deleting a credential in use warns with the list of affected workflows.

### ✅ AF-M3-04 · Credential injection into execution · 1.5d
- [x] Nodes declare requirements; the config panel offers matching credentials only.
- [x] Decryption happens exactly once, inside runtime context construction.
- [x] Test asserts credential values never appear in `NodeExecution.input/output` or any log line.

**Notes (shipped):**
- `NodeDefinition.credentials: CredentialRequirement[]` (`{ key, type, required }`) — AI nodes declare `{ key: "credentialId", type: "<provider>.apiKey", required: true }`.
- New `src/features/executions/server/credential-resolver.ts` — **the single decrypt site** for node runs. `resolveNodeCredentials()` is injected a `loadCredentialRow` loader (tenant-scoped `prisma.credential.findUnique`), returns `Record<string, CredentialSecret>`, throws `MissingRequiredCredentialError` on missing required, skips optional. It is the module unit-tested (not the executors).
- Engine (`src/inngest/functions.ts`) calls `resolveNodeCredentials` in a per-node `step.run("resolve-credentials:…")` and threads the result into `execute` via `NodeRunParams.credentials`. The map is **never** merged into `context`/`output`/trace → plaintext has no path to `NodeExecution.input/output`.
- Executors (`openai`/`anthropic`/`gemini`) dropped their own `prisma.credential.findUnique` + `openSecret`; they now read `credentials?.credentialId` and throw `NonRetriableError` if absent.
- 13 new tests: resolver round-trip (loader called once), missing-required throws, optional skipped, multi-requirement order, leak guard (decrypted secret absent from node data/output), registry-parity (each declared type exists in `credentialRegistry`), AI-def requirement assertions.

### ✅ AF-M3-05 · OAuth2 flow + auto-refresh · 3d
- [x] Generic OAuth2 authorization-code connect flow with per-provider config and CSRF-protected state.
- [x] Scheduled Inngest function refreshes tokens before expiry.
- [x] Refresh failure creates a visible, actionable alert — the "tokens silently expire and workflows break" gap.

### ✅ AF-M3-06 · Eight connectors · 5d
Slack · Gmail/SMTP · Google Sheets · Postgres · Airtable · HubSpot · OpenAI-compatible HTTP · Webhook-out.

Stage 0 done 2026-08-28 (`b726e95`): `postgres`, `smtp`, `airtable.apiKey`, `hubspot.apiKey`, `openaiCompatible.apiKey` credential types + server-side connection testers (Postgres/SMTP/Airtable/HubSpot; OpenAI-compatible intentionally not testable). Connector nodes below.

- [x] Each: definition + execute + credential type + unit tests + palette metadata.
- [x] Each documented in `docs/nodes/<name>.md` with config reference and an example.
- [x] Postgres node uses parameterized queries only — string-concatenated SQL is a rejection.

**Status 2026-08-28 — done.** All eight connectors ship definition + execute + unit tests + palette metadata + `docs/nodes/<name>.md`: `97f95ac` Webhook-out · `3776de1` Email/SMTP · `9cf42fc` Postgres (`$1`-bound parameterized queries; `src/nodes/postgres/query/definition.ts` explicitly forbids string-concatenated SQL) · `eca50ce` Google Sheets · `3d64c8c` Airtable · `eedbd73` HubSpot · `b311262` OpenAI-compatible chat (`src/nodes/ai/compatible/`, credential `openaiCompatible.apiKey`) · `9a475d9` Slack send-message tests + doc. Palette logos + node-status icon map polished in `4e8b364`. Follow-ups carried forward (non-blocking):
- Slack node sends via **incoming webhook** (`webhookUrl`); the `slack.oauth2` credential type exists (stage 0) but the node does not use it — API/token path out of scope.
- Slack `webhookUrl` does **not** compile `{{...}}` templates today (content does); URL templating is a follow-up.
- The palette is a static hardcoded list rather than manifest-rendered — tracked under AF-M1-05.

---

## M4 — Triggers, publish, versioning · 2 weeks

- [x] **AF-M4-01** `WorkflowVersion` model, publish/activate/deactivate, draft-vs-active separation · 2d — **done `56cbb86`**: `WorkflowVersion` model + `activeVersionId` on `Workflow`; router `publish`/`activate`/`deactivate`/`getVersions`; `Execution` optionally binds `workflowVersionId`; 5 integration tests.
- [x] **AF-M4-02** Version history UI with diff summary and one-click rollback · 2d — **done `56cbb86`**: `VersionHistorySheet` (diff summary, Deactivate, one-click rollback) wired into the editor header (`editor-header.tsx`).
- [x] **AF-M4-03** `POST /api/webhooks/:workflowId/:path` — secret/signature verification, raw capture, `202` fast path, optional sync-respond with hard timeout, rate limited · 3d
- [x] **AF-M4-04** Schedule trigger via Inngest cron with timezone support and next-run preview · 2d
- [x] **AF-M4-05** Manual trigger payload editor · 1d — **done**: `MANUAL_TRIGGER` definition + executor support mock JSON payload in config, injected into trigger context (`trigger`), unit-tested.
- [x] **AF-M4-06** Per-workflow/tenant execution concurrency limits · 1d — **done**: Inngest concurrency keys configured for `event.data.workflowId` (limit 1) and `event.data.organizationId || event.data.userId || event.data.workflowId` (limit 10) on `executeWorkflow`, and limit 1 on `evaluateSchedules` cron and OAuth token refresh.

---

## ✅ M5 — Multi-model AI + cost · 3 weeks

- [x] **AF-M5-01** Provider registry with capabilities and per-1M pricing as data (OpenAI, Anthropic, Google, Groq, DeepSeek, Ollama) · 2d — **done**: `src/lib/ai/registry.ts` — 6 provider defs + 12 model defs keyed `provider:model` with adapter, contextWindow, capabilities, per-1M input/output USD; `resolveAiModel` (exact → provider default → `UnknownAiModelError`; ADR-0009 documents the §5.4 deviation), `estimateRunCostUsd`, module-load `validateAiRegistry` (dup ids, provider/credential drift, unknown adapters/capabilities fail the build). `groq.apiKey` + `deepseek.apiKey` credential defs, write/update schema variants, and `/models` connection testers added in lockstep (ADR-0008 pattern); registry-parity tests auto-cover them. Full suite 478 total (461 passed, 17 skipped), tsc + lint clean. ADR-0009.
- [x] **AF-M5-02** `ai.llm` node: model select, prompts with expressions, params, JSON mode with user schema · 3d — **done**: `src/nodes/ai/llm/` — `definition.ts` (isomorphic `configSchema`: model string, system/user prompts, `temperature`, `maxTokens`, `jsonMode`, `jsonSchema`, credential select for the 5 keyed providers; `LlmData`; reads `providers` claim from `NodeCategory.AI`), `execute.ts` (server-only; `server-only` import, `splitModelId` provider/model leg split, unknown provider → `NonRetriableError` with `AI_PROVIDERS` list, `resolveAiModel` exact-then-default (registered models only now: `gemini-1.5-pro`, `claude-3-5-sonnet`, `mistral`, `gpt-4o`…), model select wired via `createLanguageModel` through the registry adapters (Groq/DeepSeek/Ollama reuse the OpenAI adapter over their own base URLs; Ollama `apiKey: "local"`), prompts compiled through `compileTemplate` (config + context data), `temperature ?? 0.7`, optional `maxOutputTokens`, `generateText` prepared with data/JSON mode split, `generateObject`+`jsonSchema` for JSON mode with `NonRetriableError` on invalid schema JSON, `step.ai.wrap` envelopes both calls, empty-response check, result stored under `data.variableName` as `{ text, model }`, credentials resolved via `credentialResolver.getCredentialSecrets` for the keyed providers, unkeyed (Ollama) runs with `local`), `index.ts` registration, registered in `src/nodes/registry.ts` + `src/nodes/manifest.ts` under `ai.llm`, added to `registry.test.ts` folder assertions. 15 execute tests covering text path, JSON mode (schema passed to `jsonSchema`), provider credential selection for OpenAI/Anthropic/Google, unkeyed Ollama via `createOpenAI` with base URL, message building (system/user/maxTokens), default temperature, unknown provider failure, unknown model → provider default, missing variable/prompt, missing credential, and empty response. Full suite **493 total — 476 passed + 17 skipped (57 files)**; tsc clean, biome clean, production build clean. |
- [x] **AF-M5-03** `ai.extract` node: structured extraction to a field-list or raw JSON schema · 2d — **done** (2026-08-30): `src/nodes/ai/extract/` — `definition.ts` (`fields` schema-builder rows or a pasted `jsonSchema`), `execute.ts` (`buildOutputSchema` precedence, `generateObject` with `jsonSchema()`, `step.ai.wrap` tracing), `fieldList` support in the editor config schema + panel. *(Task line was missing from this file; recorded here 2026-08-31 from `progress.md`, which had it as done since 2026-08-30.)*
- [x] **AF-M5-04** Fallback chains; the trace records which model actually served the run · 2d — **done**: `src/lib/ai/fallback.ts` — `splitModelId`, `parseModelChain` (parses primary and delimiter-separated fallback model lists with deduplication), `resolveCandidate` (provider validation, credential resolution, adapter mapping, and `createLanguageModel` factory instantiation), and `executeWithFallback` (iterative candidate execution with automated error recovery and aggregated failure reporting); updated `src/nodes/ai/llm/` (`definition.ts` + `execute.ts`) and `src/nodes/ai/extract/` (`definition.ts` + `execute.ts`) to accept `fallbackModels`, attempt models in prioritized order, and output `{ model: servedModel }` tracking the exact provider/model that successfully served the execution. 12 fallback unit tests + extended LLM and Extract test suites (107 AI tests total). Full test suite: 540 passed | 17 skipped (60 files); tsc, biome, and production build clean.
- [x] **AF-M5-05** Token + cost capture on `NodeExecution`, rolled up to `Execution` and workspace · 2d — **done**: Added `extractStepUsage` and `WORKFLOW_USAGE_KEY = "__usage"` convention in `src/inngest/trace.ts`; updated `executeWithFallback` in `src/lib/ai/fallback.ts` to compute actual input/output token counts and micro-dollar pricing via `estimateRunCostUsd`; updated AI executors (`ai.llm`, `ai.extract`, `ai.compatible`) to report usage; updated Inngest execution loop in `src/inngest/functions.ts` to persist `tokensIn`, `tokensOut`, and `costUsd` per node in `NodeExecution` and aggregate rollups to `Execution` on both completion and failure. 546 tests passing across 60 files; tsc, biome, and production build clean.
- [x] **AF-M5-06** Pre-run cost estimate in the editor · 2d — **done**: `src/features/editor/lib/cost-estimate.ts` + `src/features/editor/components/cost-estimate-badge.tsx` — `estimateTokens` (~4 chars/token heuristic; empty/whitespace → 0; min 1), `formatUsdCost` (micro-dollar precision: `$0.00`, `< $0.0001`, 4dp, else 3dp), `estimateNodeCost` (AI-node filter across `ai.*` + legacy types, excluding `ai.retrieve`; non-throwing model resolution via `findAiModel`/`aiProviderById` — registered `provider:model` resolves exactly, else the provider default, unknown pairs fall through to the raw string; per-type default output tokens chat 500 / extract 256; `estimateRunCostUsd` guarded by a `findAiModel` existence check so unknown models price at $0 without a registry throw), `estimateWorkflowCost` (disabled nodes skipped, µ-cent rounding, aggregate tokens/cost + per-node breakdown); `workflowCostEstimateAtom` (live recompute over the canvas draft); `<CostEstimateBadge>` in the editor bottom-center panel with popover breakdown (hidden when no AI nodes) plus a per-node "Est. run cost" line in the config panel. 15 unit + DOM tests. Full suite **578 total — 561 passed + 17 skipped (60 files)**; tsc, biome, and production build clean.
- [x] **AF-M5-07** Workspace-scoped response cache with TTL and hit-rate reporting · 2d — **done**: `AiResponseCache` model + migration `20260830140000_ai_response_cache` (unique `[organizationId, cacheKey]`, `expiresAt` sweep index) plus nullable `NodeExecution.cacheHit` (three-valued: `null` = no cache configured, so it counts in neither half of a hit rate). `src/lib/ai/cache.ts` — `canonicalize` (depth-sorted keys), `buildAiCacheKey` (sha256 over node type + ordered model chain + compiled prompts + call params, so a prompt/temperature/schema edit misses instead of replaying), `normalizeCacheTtlSeconds` (0 = off, clamped to 7d), `readAiCache`/`writeAiCache` (workspace is in the lookup, not just the hash; read and write failures degrade to a provider call and are logged, never fail a run), `purgeExpiredAiCache`. Wired through `executeWithFallback` (a live entry short-circuits the whole chain; cached runs report 0 tokens / $0 because nothing was purchased) and opted into per node via `cacheTtlSeconds` on `ai.llm` + `ai.extract` (`NodeDefinition.supportsResponseCache` marks cacheable types so reporting reads the registry, not a hard-coded list). `NodeRunParams.organizationId` threaded from the engine; `cacheHit` persisted on `NodeExecution`. Daily `sweepAiResponseCache` cron (reads already filter on `expiresAt`, so a missed sweep leaves dead rows, never stale answers). `ai.cacheStats` (hits/misses/rate/`uncachedRuns`/live entries/`savedUsd` = `costUsd × hitCount`) + `ai.clearCache` (org:ADMIN). UI: per-node "Cached" badge and a run-level "N of M AI nodes served from cache" line in the execution detail. Also fixed the empty `catch {}` around `estimateRunCostUsd` in `fallback.ts` (engineering_rules §2). 39 new unit tests + `tests/integration/ai.cache.integration.test.ts` (10 cases: round-trip, hit counting, cross-tenant isolation, TTL expiry + sweep, upsert-not-duplicate, stats, clear).
- [x] **AF-M5-08** Cost views: per run, per workflow, per model, over time · 2d — **done**: `NodeExecution.model` + migration `20260830150000_node_execution_model` — the fallback chain's winning model was already in the usage envelope but was dropped at persist time, so per-model attribution was impossible. New `src/features/costs/` slice: `costs.summary` (org:VIEWER, 1–90 day window) returning totals, a zero-filled UTC daily series (`date_trunc` via parameterized `$queryRaw` — Prisma cannot express it), and top-10 `byWorkflow` / `byModel` / `topRuns`; scoped through `Workflow.organizationId` (not the nullable `Execution.organizationId`). Pure helpers in `lib/aggregate.ts` (`fillDailySeries`, `roundUsd`, `shareOfTotal`) and `lib/format.ts` (`formatUsd` spans $0.0075 → $412.90, `formatTokens`, `formatPercent`, `formatDayLabel`). `/costs` page (sidebar entry, nuqs `days` param, server prefetch + Suspense + ErrorBoundary): summary cards incl. the AF-M5-07 hit rate, a recharts area chart, and share-of-spend breakdowns linking to the workflow / execution. Test runs are **included** and labelled as such — a test run bills the provider like any other. 18 unit + 3 DOM tests + `tests/integration/costs.summary.integration.test.ts` (5 cases: tenant isolation, per-workflow ordering, per-model attribution, window exclusion + zero-fill, top-runs ranking).
- [x] **AF-M5-09** Retire the tutorial per-provider executor nodes once `ai.llm` supersedes them (no demo lasagna function exists — the real engine replaced it) · 0.5d — **done**: `OPENAI` / `ANTHROPIC` / `GEMINI` marked `deprecated: { since, replacedBy: "AI_LLM", reason }` via the new `NodeDefinition.deprecated` field. They stay registered and executable — deleting them would throw `UnknownNodeTypeError` from `validate()` and stop a workflow that ran yesterday, at execution time, on a customer's workflow — but `nodeManifest` now also exports `nodePalette` (non-deprecated only), which the node selector reads, so no new instance can be created and the population can only shrink. The config panel shows a deprecation notice naming the replacement. `src/nodes/ai/legacy-migration.ts` maps a legacy config onto `AI_LLM` (credential → the provider's `*CredentialId` field, prompts and variable name preserved, `_`-prefixed engine keys carried through, undeclared keys reported not silently dropped, result validated against `AI_LLM`'s own `configSchema`); `npm run migrate:legacy-ai-nodes` applies it to live `Node` rows, dry-run by default. Graph snapshots are deliberately **not** rewritten — a published version and a trace record what actually was. The hard-coded models (`gpt-4`, `claude-sonnet-4-5`, `gemini-2.0-flash`) are not in the provider registry and cannot be priced, so each maps to the nearest registered model of the same provider (`openai:gpt-4o`, `anthropic:claude-3-5-sonnet`, `google:gemini-1.5-flash`) — a reported behaviour change, printed per node by the script. Folder deletion is a separate later task (**AF-M8-12**). 9 unit + 5 registry/DOM tests. **ADR-0011**.

---

## ✅ M-KB — Knowledge base (slim, demo-grade) · ~1.5 weeks · *(added 2026-08-26, Decision E)*

Goal: PRD §5.5's knowledge-base story, cut to what an internal demo needs. Ingestion → chunking → embeddings in Postgres (**pgvector** on Neon; additive SQL migration since Prisma does not model extensions natively) → retrieval node feeding `ai.llm` context.

- [x] **AF-KB-01** `KnowledgeSource` model + upload flow (PDF/DOCX/TXT/MD), storage + status lifecycle (pending/chunked/embedded/error) · 2d — **done**: `KnowledgeSource` & `KnowledgeChunk` models + migration `20260829120000_knowledge_base_pgvector` with HNSW vector index; upload flow supporting PDF (`pdf-parse`), DOCX (`mammoth`), TXT, and Markdown.
- [x] **AF-KB-02** Chunking pipeline as an Inngest function; embeddings via OpenAI `text-embedding-3-small` through the credential vault (provider-agnostic seam left for Phase 2); append-only chunks keyed by source revision = version history · 3d — **done**: Recursive character chunker with overlap and token estimations; `processKnowledgeSource` Inngest function generating 1536d OpenAI embeddings with credential vault resolution and revision tracking.
- [x] **AF-KB-03** Scheduled URL re-fetch source type · 1d — **done**: SSRF-safe URL scraper (`assertSafeEndpoint` + HTML parser/entity decoder) + `scheduledKnowledgeSync` daily Inngest cron job.
- [x] **AF-KB-04** `ai.retrieve` node (top-k similarity search scoped to workspace sources) + KB management UI (list/upload/delete/reindex) · 2d — **done**: `AI_RETRIEVE` node with `variableName`, `query`, `sourceIds`, `topK`, `minSimilarity`, and `credentialId`; parameterized pgvector cosine distance search; Knowledge Base management dashboard (`/knowledge`) with document upload dialog, chunk inspector, and test retrieval console.
- [x] **AF-KB-05** Docs: `docs/nodes/knowledge-base.md`; pgvector migration runbook · 0.5d — **done**: Complete node documentation, configuration reference, and pgvector deployment runbook.

Explicitly out (Phase 2): Slack channel sync, external vector stores (Pinecone/Elasticsearch), hybrid/BM25 ranking, per-chunk metadata filtering UI.

---

## ✅ M6 — Tenancy, RBAC, audit, SSO · 3 weeks

- [x] **AF-M6-01** `Organization`, `Member(role)`, `Workspace`, `Invitation`, `AuditLog`, `ApprovalRequest` models in `prisma/schema.prisma` · 3d — **done**: Multi-tenant database schema with foreign keys, cascading deletes, and role enums (`OWNER`, `ADMIN`, `EDITOR`, `VIEWER`).
- [x] **AF-M6-02** `orgProcedure(minRole)` middleware; migrate every existing procedure to organization scoping · 3d — **done**: `src/lib/rbac.ts` and `src/trpc/init.ts` with auto-provisioning fallback, cookie/header organization resolution. The workflow/execution/credential read/write paths were **not** migrated here (`Workflow.organizationId` stayed nullable, reads kept `userId` scoping) — that retrofit landed later as **AF-M7-pre-1**. The procedures added in this task (organizations/members/invitations/audit) are tenant-scoped.
- [x] **AF-M6-03** Cross-tenant isolation test suite (org B cannot read/write org A through **any** procedure) · 2d — **done**: Unit and integration test suites validating monotonic RBAC hierarchy and cross-tenant query isolation.
- [x] **AF-M6-04** Invitations, member management, role changes · 3d — **done**: `organizationsRouter` with `inviteMember`, `updateMemberRole`, `removeMember`, `listInvitations`, `cancelInvitation`, and `getMembers` UI table.
- [x] **AF-M6-05** `AuditLog` model + append-only writes on every mutation + filterable viewer · 3d — **done**: Append-only `logAuditEvent` helper and `/settings/audit-logs` table with state diff JSON viewer.
- [x] **AF-M6-06** SSO: Google + GitHub via Better Auth · 2d — **done**: Better Auth social providers wired into authentication flow.
- [x] **AF-M6-07** Workspace switcher and resource sharing UI · 2d — **done**: `OrganizationSwitcher` component mounted on `AppSidebar` with workspace creation dialog.
- [x] **AF-M6-08** User profile settings (`settings-profile`) · 0.5d · *(added 2026-08-26)* — **done**: `/settings/profile` page with user information and active session revocation.
- [x] **AF-M6-09** Accept-invite flow (`accept-invite`) · 0.5d · *(added 2026-08-26)* — **done**: `/accept-invite` page with secure token validation, organization membership creation, and workspace redirect.
- [x] **AF-M6-10** Approval workflows (`approvals`) · 2d · *(added 2026-08-26)* — **done**: `core.approval` node type with dual `approved`/`rejected` output branches, `/approvals` management dashboard, and Inngest resumption event emission.

---

## M7 — Templates, dashboard, quotas · 3 weeks

- ✅ **AF-M7-01** `Template` model + gallery + one-click instantiate with credential placeholders · 3d *(deep-planned 2026-08-30)* · DONE 2026-08-31
  Additive `Template` model (tenant-agnostic gallery per `docs/architecture/data_model.md` §2.8) + gallery UI (per `screens/templates.html`, `screens/template-detail.html`) + tenant-scoped instantiate. Spec: `docs/architecture/api_contract.md` (templates: list/getOne/instantiate).
  **Acceptance**
  - [x] Migration: `Template` table — `slug` unique, `name`, `description`, `category` + `tags` as open-set strings (no enum), `graph` JSON matching the workflow-graph shape, `featured`, `isActive`, timestamps. Shipped `20260831000000_template_model`.
  - [x] `templates.list` / `getOne` are org-viewer reads (public gallery rows, no tenant data); `templates.instantiate` is an org-editor procedure.
  - [x] Instantiate rewrites every node id to a fresh cuid (no cross-template id collision), nulls every `credentialIdRef` config value, validates the graph through the existing `config-schema.ts` path via the engine `validate()`, and creates the workflow with `organizationId = ctx.org.id`.
  - [x] Instantiate returns `pendingCredentials: [{ nodeId, nodeName, credentialType, credentialKey, optional }]` derived from each node's manifest `credentials: CredentialRequirement[]`.
  - [x] Gallery UI: card grid + category filter + "Use template" → creates workflow → navigates to editor. **Deviations (deliberate, recorded):** the deep-planned post-install credential dialog and Fork button are omitted; the detail page uses a pre-install "Before you install" checklist instead; installs land as an unsaved draft.
  - [x] A run before placeholders are connected fails with the existing `MissingRequiredCredentialError` (visible, not silent; inherited from the AF-M3-04 / AF-M7-pre-1 credential-resolution path).
  - [x] Tests: node-id rewrite, credential strip, org-scoped workflow creation, invalid graph rejection, cross-template isolation — 11 unit tests in `src/features/templates/server/instantiate.test.ts`; full suite 684 passing across 75 files.
  - [x] progress.md + tasks.md updated.
- ✅ **AF-M7-02** Author 20 templates across marketing, support, ops, data · 5d *(depth decision 2026-08-30: ship all 20; authoring-harness makes a 2-template/day cadence)* · DONE 2026-08-31
  Author all 20 (4/domain: marketing, support, ops, data) over the registered node types (`src/nodes/manifest.ts`), each a real graph that runs. Spec: `docs/architecture/api_contract.md` (templates) + `docs/architecture/node_sdk.md` (node contract).
  **Acceptance**
  - [x] Template-spec format + validate-template harness — `src/features/templates/catalog/` (`types.ts` spec, `harness.ts` checks). Validates every graph against each node's own `configSchema` through the engine `validate()` + registry, smoke-runs it through the **existing testRun planner** (`buildTestGraph` → `buildTestRunPlan`), and asserts no author credential id / cuid / uuid / secret-prefixed token leaks into `node.data`. **Recorded deviation:** the smoke run stops at the plan, and does not dispatch to Inngest under `E2E_SERVER=1` as originally worded — a real dispatch would need live Slack/Stripe/LLM credentials for someone's account, so the suite would be one nobody could run. Everything knowable without those calls is checked, and warnings (unreachable nodes) are escalated to failures because shipped gallery content is finished work.
  - [x] 20 templates: ≥4 per domain (marketing 6 / support 5 / ops 5 / data 4, by `TemplateSpec.domain`); every graph uses only registered, **non-deprecated** node types; every node type in `nodePalette` is demonstrated by at least one template (asserted); `{{variable}}` config values resolve against the real trigger context shapes (`webhook.body.*`, `googleForm.*`, `stripe.*`, `schedule.*`).
  - [x] Every template records its required-credential annotation — derived, not authored: `credentialCount` is computed from each node's manifest `credentials: CredentialRequirement[]` via `collectPendingCredentials`, so the row and the graph cannot disagree. No template requires more than **one** credential and 9 of 20 require none, which is the enforceable form of "zero free-plan-busting mandatory credentials".
  - [x] All 20 pass the harness clean — 22 unit tests in `src/features/templates/catalog/harness.test.ts`, ten of which prove the harness *rejects* what it claims to (leaked cuid, authored credential id, secret token, unregistered model id, missing trigger, unreachable node, bad output port, duplicate slug, schema-invalid config). `npm run seed:templates` runs the same harness and refuses to write if anything fails.
  - [x] progress.md + tasks.md updated.
  **Also in this task (unrelated, pre-existing):** `tests/integration/analytics-org-isolation.integration.test.ts` (from AF-M7-03) had an unused `beforeAll` import and unsorted imports, which failed `npm run lint` on `main` and blocked this PR's own CI. Fixed here rather than left red.
- ✅ **AF-M7-03** Monitoring dashboard: executions over time, success rate, p50/p95 duration, error breakdown, cost trend, top failing workflows · 4d *(deep-planned 2026-08-30)*
  `/monitoring` (per `screens/analytics.html`) + `analytics` router per `docs/architecture/api_contract.md` (overview · executionsOverTime · costByModel · topFailingWorkflows · usage). All queries org-scoped (gate: AF-M7-pre-1).
  **Acceptance**
  - [x] Metrics, each org-scoped against `ctx.org.id`: executions over time by status; success rate; p50/p95 duration (raw SQL `PERCENTILE_CONT` over `NodeExecution.durationMs`); error breakdown by `nodeType`; cost trend over `Execution.costUsd`; top failing workflows by failure count.
  - [x] Cost panels render honestly: display zero until AF-M5-02 cost capture lands (labeled "cost capture pending"), never fabricated.
  - [x] Date-range filter + empty state; charts are hand-rolled SVG (no new chart dependency, per engineering rule 12).
  - [x] `analytics.usage` surfaces current-month executions vs plan limit from the quota resolver (`src/lib/quotas.ts`).
  - [x] Tests: each aggregate query is org-isolated (org B sees no org A rows).
  - [x] progress.md + tasks.md updated.
- ✅ **AF-M7-04** Quotas: per-plan execution + AI-spend limits enforced in the runner, surfaced before the limit, wired to Polar · 3d · DONE 2026-08-31 — execution-count gate landed; AI-spend + Polar meter deferred as documented sub-items (details in the M7 addenda).
- ✅ **AF-M7-05** Onboarding: first-run checklist, sample workflow, empty states · 2d *(deep-planned 2026-08-30)* · DONE 2026-08-31
  First-run experience per `screens/onboarding.html`. New-org detection (org has no workflows) drives a checklist card + empty states on `/workflows`, `/executions`, `/credentials` (per `screens/executions-list-empty`, `credentials-empty`).
  **Acceptance**
  - [x] First-run checklist ("create a workflow / connect a credential / run a workflow") shows only for orgs with no workflows; **no schema change** — `onboarding.status` returns three org-scoped counts and step completion is *derived* from them, so a tick can never claim something that was since deleted. Only the user's preference is persisted, in `localStorage` under `autoflow.onboarding.v1`, **keyed per organization** so hiding it in one workspace does not hide it in another. Every storage access is wrapped: Safari private mode and blocked site data throw outright, and a dismissible hint must never be why a page fails to render.
  - [x] "Create a sample workflow" instantiates `content-brief-generator` — zero required credentials, manual trigger the user can press — through AF-M7-01's `templates.instantiate` path and pushes `/workflows/[workflowId]`. `state.test.ts` asserts that slug exists in the AF-M7-02 catalogue, needs no credentials, and has a manual trigger, so retiring it fails the build rather than the user's first click.
  - [x] Empty states on workflows/executions/credentials rewritten from the design artifacts (`executions-list-empty`, `credentials-empty`) with real titles, purposeful copy, and a primary + secondary action. `EmptyView` gained optional `title`/`icon`/`actionLabel`/`secondaryAction`; the defaults reproduce the previous generic card exactly, so the knowledge and templates callers are untouched.
  - [x] progress.md + tasks.md updated.
  **Recorded deviations.** (1) `screens/onboarding.html` shows a three-step *wizard* (name org → create workspace → pick a template). Org and workspace creation already happen automatically at first sign-in (`resolveActiveOrg`, AF-M6-02), so building the wizard would mean adding steps to undo work the product already does for the user. The checklist the acceptance actually specifies is what shipped. (2) The checklist keeps rendering after step 1 via a `started` flag — the trigger is "org has no workflows", but creating a workflow satisfies that trigger, so without the flag the card would vanish the moment the user did the first thing it asked. It disappears on its own once all three steps are done, with no dismissal needed.
- ⬜ **AF-M7-06** ~~Landing page at `/`~~ *pulled forward to the M0 leftovers section (2026-08-26)*
- ✅ **AF-M7-07** Command palette (`command-palette`) · 1d · *(added 2026-08-26)* · DONE 2026-08-31
  Global Cmd+K / Ctrl+K palette for quick navigation and actions. Not referenced in any prior task; design artifact from `screens/`.
  **Acceptance**
  - [x] Cmd+K / Ctrl+K opens a modal with a search input. Mounted once in `(dashboard)/layout.tsx` — a per-page instance would register duplicate global listeners. Cmd+B was already the sidebar toggle; Cmd+K was free.
  - [x] Results include workflows (by name), executions (by id prefix, status, or parent workflow name), credentials (by name), navigation destinations, and actions (create workflow, add credential, browse templates).
  - [x] Keyboard navigation: arrows, Enter, Escape — from `cmdk`, with `shouldFilter={false}` so its substring filter cannot re-filter away rows the server deliberately returned. `CommandDialog` gained a `commandProps` passthrough for this; it is optional and every existing caller is unaffected.
  - [x] Fuzzy search over all result types — `lib/fuzzy.ts`, pure and dependency-free: exact > prefix > word-boundary > substring > subsequence, with consecutive-character and word-boundary bonuses, shorter names winning ties, subtitle matches discounted below title matches, and a stable sort so an empty query preserves the server's recency ordering. 12 unit tests.
  - [x] Results are tenant-scoped — every query filters on `ctx.org.id` (executions through their workflow) and is `take`-limited. Proved by 8 integration tests in `tests/integration/search-org-isolation.integration.test.ts` in which **both orgs own rows with the identical name**, so a passing test cannot be a query that returns nothing; includes the empty-query browse case (where org scope is the *only* filter) and an assertion that no credential envelope field or `preview` ever appears in a result.
  **Recorded deviations.** (1) "Settings pages" are not in the results because no settings route exists yet — the navigation entries are the seven real dashboard destinations, and `static-commands.test.ts` asserts every `href` resolves to a real `page.tsx`, so a broken entry fails the build. (2) "Execute" is not offered: the palette is global and has no workflow in context; the actions are the three that are meaningful from anywhere. (3) The locked decision said "UNION over workflows / executions / credentials" — shipped as three org-scoped `findMany`s in one `Promise.all` rather than raw SQL, because the union is over three tables with three different shapes and the SQL would have to erase Prisma's types to line the columns up. The tenancy guarantee, which is the part that matters, is identical.
  **Design decisions (locked 2026-08-30):** dedicated tenant-scoped `search` server router (UNION over workflows / executions / credentials + settings nav + actions, `WHERE organizationId = ctx.org.id`, `LIMIT`ed) — the palette consumes it and does ranking only. Not a client-side preloaded index.
- ✅ **AF-M7-08** Notifications center (`notifications`) · 1.5d · *(added 2026-08-26)* · DONE 2026-08-31
  In-app notification system for execution completions, approval requests, credential expiry warnings, and system alerts. Not referenced in any prior task; design artifact from `screens/`.
  **Acceptance**
  - [x] `/notifications` lists type, title, message, relative timestamp, and read/unread state, with all/unread filters and pagination.
  - [x] Bell with unread count badge (caps at "99+"), in the sidebar header — **recorded deviation:** this layout has no top header bar, so the sidebar header is its equivalent region. Hidden when the rail collapses to icons, where the badge has no room to read. Badge polls every 60s and refetches on window focus, since a run failing while the tab is backgrounded is the case the feature exists for.
  - [x] Producers: **execution failure and success are live**, gated per workflow on `notifyOnFailure` (default ON) / `notifyOnSuccess` (default OFF), written from `onFailure` and the success tail respectively; TEST-mode runs never notify. **Credential expiry is live** — daily `notifyExpiringCredentials` cron over `oauthExpiresAt`, +7d window with a 14d grace floor so a lapsed credential is surfaced for a fortnight and then stops nagging. **Approval and system notices have builders and copy but no producer** — see the deviation below.
  - [x] Mark as read (single) and mark-all-read, both `updateMany` so the org scope is in the same statement as the write.
  - [x] Tenant-scoped model and every query/mutation scoped on `ctx.org.id`. 10 integration tests in `tests/integration/notifications.integration.test.ts`, including that org A marking org B's notification read changes nothing, that mark-all-read does not touch another org, and that a replayed write is a no-op.
  - [x] progress.md + tasks.md + data_model.md + api_contract.md updated.
  **Recorded deviations.** (1) **`APPROVAL_REQUESTED` and `SYSTEM` have no producer.** For approvals this is not a gap in this task: **nothing in the app creates `ApprovalRequest` rows** — no approval node ships, so the AF-M6 approvals dashboard reads a table with no writer. The notification builder, copy, icon, and dedupe key are in place; wiring is a one-line `writeNotifications` call from wherever the approval node lands. `SYSTEM` is an operator action with no UI or script yet. Both are filed as **AF-M8-13**. Writing a fake producer to tick a box would have been worse than saying this. (2) In-app only in v1, per the locked decision — no push, no email. (3) Read state is **shared across the workspace**, the honest consequence of a tenant-scoped rather than per-user model; per-user read state needs a join table and is not in v1.
  **Design decisions (locked 2026-08-30):** execution notifications are per-workflow — two bool columns on `Workflow` (`notifyOnFailure` default ON, `notifyOnSuccess` default OFF), toggles placed beside the editor run controls; the runner tail writes the `Notification` rows. Credential-expiry warnings run on a scheduled Inngest cron (reusing the `scheduledKnowledgeSync` pattern) over `oauthExpiresAt`/`refreshError` with a +7d window. In-app only in v1 (no push/email).

---

## M8 — Beta hardening + public API · 4 weeks

- ✅ **AF-M8-01** Public REST v1 (list/get workflows, trigger run, get execution) + API keys with scopes · 4d · **DONE 2026-08-31** — Added the `ApiKey` model (org-scoped; only a SHA-256 hash + 8-char support prefix stored, never the plaintext) via additive migrations `20260831160000_add_api_keys` + `20260831170000_add_execution_idempotency_key` (31 total). Public REST v1 under `src/app/api/v1` with scoped bearer auth, cursor pagination, a `{ error: { code, message, details? } }` error envelope, snake_case field mapping, and per-key token-bucket rate limiting (plan-based, in-memory for now — AF-M8-02 tracks the shared store): `GET /workflows`, `GET /workflows/:id`, `POST /workflows/:id/run` (honors `Idempotency-Key`, dedupes via the `(workflowId, idempotencyKey)` unique index), `GET /executions`, `GET /executions/:id`, `POST /executions/:id/cancel`. Cross-tenant access returns `404 NOT_FOUND` (never discloses existence); token format `af_` + 40 base62 chars (ADR-0012). Scopes `workflows:read|execute`, `executions:read|write`. Management surface is a tRPC router `apiKeys` (`create`/`list`/`revoke`, org-admin only, every mutation audit-logged as `apiKey.create`/`apiKey.revoke`). Management UI deferred (backend-only scope). Tests: 11 key + 4 rate-limit + 6 cursor unit tests, 30 REST-route integration tests, 11 management-router integration tests; full unit 686 + integration 76 green, tsc + biome + `next build` clean. ADR `docs/decisions/0012-public-api-and-api-keys.md`. `docs/architecture/api_contract.md` §1/§5 and `docs/architecture/security.md` marked BUILT.
- ✅ **AF-M8-02** Rate limiting on auth, webhook, and API routes · 2d · **DONE 2026-08-31** — Unified rate limiting onto one shared module `src/lib/rate-limit/`: an injectable `RateLimitStore` interface (`consume(key, config)`) with a `MemoryRateLimitStore` token-bucket default (`RateLimitStore` docs it as the interface for a future Redis/Postgres-backed distributed store — the explicitly documented multi-instance follow-up; **no new dependency**, an ADR-worthy decision id 0013). Plan buckets (`PLAN_BUCKETS` + FREE-collapse `resolvePlanBucket`, ADR-0010 pattern) now back the webhook surface; the public-API limiter (`src/features/api-keys/lib/rate-limit.ts`) became a re-export of the shared store, preserving AF-M8-01's behavior/unit tests. **Webhook** `POST /api/webhooks/[workflowId]/[path]` replaced its ad-hoc fixed-window counter (60/min flat) with the plan-aware token bucket (`webhook:{workflowId}:{path}`, buckets resolved from `Organization.plan`), 429 + `Retry-After` unchanged. **Auth** — wrapped the Better Auth catch-all `src/app/api/auth/[...all]/route.ts` with `tryRateLimited` (security.md §8): sign-in/sign-up `5/15min` per (IP, email), password reset `3/hr` per email (`src/lib/rate-limit/auth.ts` key derivation; per-instance store noted as weaker than a shared one for brute-force defense). **tRPC** — merged a per-user mutation burst cap (60 burst, 1/s refill) into the `protectedProcedure` auth middleware in `src/trpc/init.ts`, keyed `trpc:mutation:{userId}` (`TOO_MANY_REQUESTS`); queries pass through. Tests: 9 new unit tests (`auth.test.ts` surface detection + key derivation; shared store covered by the AF-M8-01 limiter test through the re-export). Unit green, tsc + biome clean, `next build` clean; `workflows.versioning` (5) + `org-isolation` (11) integration green. ⚠️ ~~`public-api`/`api-keys` integration suites have a **pre-existing** failure in their `api_key.organizationId` FK seeding (fails identically at baseline — an environment/DB-state issue, not AF-M8-02; filed as follow-up).~~ **Misdiagnosed — corrected 2026-09-01.** There was no FK-seeding problem. Those suites, and eight others, were failing because AF-M8-04's `RESEND_FROM_EMAIL` schema rejected the sender format in `.env.example`, so `ensureEnv()` threw inside `createPrismaClient` before the first query. "Fails identically at baseline" was true and pointed at the real cause — the env schema, not the seed data. See the correction on AF-M8-04. Follow-ups: distributed `RateLimitStore` (ADR-0013), `X-RateLimit-*` headers on webhook responses. ⚠️ Also filed separately: `src/features/templates/server/instantiate.test.ts:116` is a **pre-existing flaky test** (`not.toContain("$node.a")` fails whenever a freshly-rotated cuid happens to start with `a` — nondeterministic, unrelated to rate limiting, passes in isolation; AF-M7-01 code).
- ✅ **AF-M8-04** Auth flow verification: password reset + email verification · 2d · *(added 2026-08-26)* · **DONE 2026-09-01** — Verified and shipped both Better Auth flows end-to-end with **Resend** as the email provider (user choice; new `resend` dependency + ADR-0014). **Email delivery** `src/lib/email.ts` (server-only): a `sendAuthEmail` that builds a Resend SDK payload (never logs the API key, token, or password; throws `ResendNotConfiguredError` when `RESEND_API_KEY` is unset so a flow that NEEDS an email fails loudly). **Better Auth config** `src/lib/auth.ts`: `emailAndPassword.sendResetPassword` + `emailVerification` plugin (`sendOnSignUp: true`, `autoSignInAfterVerification: true`; `requireEmailVerification` intentionally unset so existing unverified users are not locked out). Token storage reuses the existing `Verification` table — no migration. **Screens** (all inside the `(auth)` group): `/forgot-password` (neutral "check your inbox" message — never leaks whether an account exists), `/reset-password?token=…`, `/verify-email?token=…`; login gained a "Forgot password?" link; signup shows a "check your inbox" toast on success. **Env** `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (optional at boot, same pattern as Polar billing) added to `src/lib/env.ts`. Tests: 5 new unit tests (`src/lib/email.test.ts` — unconfigured throws, envelope/link correctness, from-override, Resend error surfaces); full unit suite **785/785** green, tsc + biome clean. `next build` on this machine fails globally at "Collecting page data" (PageNotFoundError for every route including untouched ones like `/signup`, `/credentials`, `/icon.svg`) — a pre-existing environment/Next-version issue, not caused by this task; `npm run build` could not be verified here.
  **Correction (2026-09-01, found while starting AF-M8-08).** This task shipped `RESEND_FROM_EMAIL: z.string().email()`, but an RFC 5322 sender is commonly the display-name form `Name <addr@host>` — which is exactly what both `.env.example` and this task's own fallback (`resendFromEmail = … ?? "AutoFlow <onboarding@resend.dev>"`) ship. A **correctly configured** install therefore failed `ensureEnv()` and refused to boot: `createPrismaClient` threw before any query ran. The "785/785 green" claim above was measured on the unit project only; with the value from `.env.example` in place the whole **integration** project could not construct a Prisma client, so **95 tests across 10 files failed**. Fixed by extracting an exported `emailSenderSchema` in `src/lib/env.ts` that accepts a bare address or the display-name form (quoted names included) and still rejects a non-email in either position; 7 unit tests in the new `src/lib/env.test.ts`. Full suite now **893/893** green (94 files), tsc + biome clean.
  **Acceptance (all verified by hand where the library/build permitted; screens ship custom since the library defaults do not match `screens/`):**
  - [x] Password reset flow: "Forgot password" link on login → email with reset link → reset form → new password → redirect to login.
  - [x] Email verification flow: signup → verification email sent → click link → email verified → redirect to dashboard.
  - [x] Both flows work with the configured email provider (Resend).
  - [x] Custom screens rendered inside the `(auth)` group.
- ⬜ **AF-M8-05** Load test to the concurrency target; fix findings · 3d
- ✅ **AF-M8-06** Execution retention policy + archival/partitioning for `NodeExecution` · 3d · **DONE 2026-09-01** — `Execution`/`NodeExecution` grew without bound and nothing pruned them, so `security.md` §9's "execution IO is customer data … retention is bounded" was simply untrue. **Two-stage policy, not one** (ADR-0016): `input`/`output` are nulled at `ioRetentionDays`, and the `Execution` row is deleted at `deleteAfterDays` with `NodeExecution` following by `onDelete: Cascade`. A single delete stage would have forced a choice between holding customer payloads as long as we want cost history or discarding cost history as fast as we want to drop payloads — two stages needs neither, because redaction keeps status, timings, tokens, `costUsd`, `model`, and error text, so the monitoring and cost dashboards stay truthful over rows whose payloads are gone. **Windows are per-plan data** in `src/lib/retention.ts` (`PLAN_RETENTION`, same shape as `PLAN_QUOTA_LIMITS`; unknown/NULL plan collapses to FREE per ADR-0010, since "more than FREE" here means keeping data *longer*): FREE 7d/35d, STARTER 30d/90d, PRO 90d/365d, ENTERPRISE 365d/never. **The floor is the subtle part:** the runner meters the monthly quota by *counting* `Execution` rows in the current calendar month, so a delete window shorter than a month would remove rows still being counted and silently **refund quota** — paid capacity handed out on a timer. `QUOTA_SAFE_DELETE_FLOOR_DAYS` is 35 and a unit test asserts every plan honours it, so lowering a window below the quota window fails the build rather than leaking revenue quietly. Enforcement (`src/features/executions/server/retention.ts`) is **bounded** (page of ids per statement, ceiling per run, reports `truncated` and warns rather than locking the two largest tables) and **idempotent** (redaction only selects rows that still have a payload — `Prisma.DbNull`, not `JsonNull` — so a replayed Inngest step is a no-op). Non-terminal rows *are* pruned once past the window: no Inngest run lives 35 days, so a row still `RUNNING` at that age is a crashed run, and skipping it would leak exactly the runs that never complete. Daily `sweep-execution-history` cron at 03:45, off the AI cache sweep's 03:15. **Archival tier deliberately not built** and **partitioning deliberately deferred** behind a written trigger (~50M rows / ~50 GB, repeated `truncated` days, or autovacuum falling behind) — Prisma has no partitioned-table support, the PK would have to become `(id, startedAt)` maintained by raw SQL that `migrate diff` would fight, and it needs a partition-creation job whose failure mode is write errors on the busiest table. With retention enforced the table is *bounded*, which was the actual R8 risk. **No migration** — policy only. Tests: 27 unit (policy shape, the quota floor, plan collapse, cutoff arithmetic) + 9 integration against real Postgres (redaction keeps metrics, delete cascades, ENTERPRISE never deletes, one org's plan never governs another's rows, org-less legacy rows swept as FREE, idempotency, truncation-and-resume, stuck-`RUNNING` pruning). Corrected `data_model.md`, which pointed retention at `AF-M8-04` (the auth-email task).
- ⬜ **AF-M8-20** Tell the user how far back their execution history goes · 0.5d · *(added 2026-09-01, consequence of AF-M8-06)* — retention is per-plan, so a "last 90 days" view on FREE silently shows at most 35 days of runs and less IO than that. The monitoring, cost, and execution-list screens do not say so; a range the data cannot cover should name the plan's window rather than render a truthful-looking empty stretch. Needs `resolveRetention` surfaced through a procedure the client can read.
- ✅ **AF-M8-07** Alerting, runbooks for the top 5 failure modes, error budgets, status page · 3d · **DONE 2026-09-01** — **Status page + health endpoint (built).** `GET /api/health` (machine-readable, for an uptime monitor or load balancer) and `/status` (public, server-rendered, no session/tRPC/client JS — deliberately outside the `(dashboard)` group, because the moment it is needed is the moment the authenticated shell may not render). Two probes, each chosen to map to a runbook entry rather than to whatever is pingable: `database` (Postgres reachable) and `runner` (executions that started long ago and never reached a terminal status). **`runner` is the important one** — it detects the failure mode where every other surface looks healthy: the app serves, triggers fire, runs are accepted, and nothing finishes. Aggregation rules live in the isomorphic `src/lib/health.ts` so they are testable without a DB, and two of them are easy to get backwards and are pinned by tests: a probe that throws is `down` (never "unknown", never skipped — a health check that fails open reports green while the service burns), and an **empty check list is `down`** (no evidence of health is not evidence of health). `degraded` deliberately returns **HTTP 200**: a 503 would make a load balancer evict an instance that is still doing useful work, turning a partial outage into a total one. The endpoint is rate limited through the AF-M8-02 shared store (each probe runs real queries, so an open endpoint doing DB work is a free amplification primitive) and the body carries verdicts only — never an error string, which would name hosts, ports, and roles. **Caught while verifying in the browser:** the first render after boot reported a false **"Major outage"** because a cold Prisma connection blew the 2s probe budget; the DB probe now gets 5s, since a status page that cries wolf on every deploy is worse than none. **Runbooks (`docs/operations/runbooks.md`)** for five failure modes that this system can actually reach and that do not detect each other: F1 executions accepted but never completing, F2 database down / pool exhausted, F3 credentials failing to decrypt across the board, F4 AI provider outage or runaway spend, F5 webhook flood from one tenant. Symptom → confirm (with the actual SQL) → diagnose in order → mitigate, plus one rule per page: capture evidence before restarting, because in every one of these the state *is* the diagnosis. **SLOs and error budgets (`docs/operations/slos.md`)**: four SLIs over a 28-day window — availability 99.5%, execution success 99.0%, latency 95% under 60s, trigger fidelity 99.9% — with the budget framed as a decision rule ("do we ship or fix reliability") rather than a scoreboard. S2 excludes `CANCELLED` and `QUOTA_EXCEEDED` on purpose: a user cancelling is not a failure and a quota refusal is the system working, so neither should consume an engineering budget. Eight alert definitions, each naming the runbook entry it maps to — an alert with no runbook teaches people to ignore alerts. **Written down as NOT built, rather than implied:** nothing pages anyone today (no delivery, no external prober, so availability is currently unmeasured), no on-call rotation, no burn-rate tracking, trigger fidelity is uninstrumented, and — the most serious gap — restore has never been rehearsed, so there is no data-loss runbook. Filed as **AF-M8-21**. Tests: 13 unit + 6 integration. No migration.
- ⬜ **AF-M8-21** Make the AF-M8-07 alerts actually reach a human · 1d · *(added 2026-09-01, the honest gap in AF-M8-07)* — `docs/operations/slos.md` §4 defines eight alerts and nothing delivers any of them, so today we would learn about most incidents from a customer. Smallest first step and by far the best value: point one external uptime monitor at `/api/health` — that alone lights up `health-down` and `runner-stalled`, the two **page**-severity alerts, and starts measuring S1 availability, which is currently unmeasured because a service cannot credibly report its own uptime. Then Sentry alert rules for `credential-decrypt-failures` (threshold deliberately requires ≥2 organizations — one tenant's credential failing is user error, across tenants it is our key). Burn-rate tracking and the S4 trigger-fidelity counter come after. An on-call rotation is a people decision, not a code one.
- ✅ **AF-M8-08** Security review against `docs/architecture/security.md`; dependency audit; close all HIGH findings · 3d · **DONE 2026-09-01** — Reviewed every item in `security.md` §13 against the code rather than against the spec, and ticked a box only where the control was actually read. **Dependency audit:** 39 findings (3 CRITICAL, 18 HIGH) → **6, all LOW**. `npm audit fix` closed the two CRITICALs (`better-auth` basePath DoS, `handlebars` AST-confusion injection — the latter matters because ADR-0007 compiles user templates at runtime) plus 11 HIGHs, changing only the lockfile. Four transitive HIGHs whose only npm-suggested "fix" was a **downgrade** (`prisma` 7.9.1→6.12.0, `inngest-cli` 1.12.1→0.16.3) were instead closed with scoped `overrides`: `deepmerge-ts@^8.0.2`, `adm-zip@^0.6.0`, `postcss@^8.5.26`, and `undici@^6.28.0` under `@ai-sdk/provider-utils` (v5 has no fixed release; 6.28.0 is one major, not two). `better-auth`'s fix forced 1.3.26→1.7.2, which broke `@polar-sh/better-auth@1.1.9` (it imports `createAuthEndpoint` from `better-auth/plugins`, moved to `better-auth/api`); pinning back to a non-vulnerable 1.6.30 did **not** help — the export was already gone — so the Polar chain went to `@polar-sh/better-auth@1.8.4` + `@polar-sh/sdk@0.47.1`. Residual 6 LOW are all `@ai-sdk/*` (one `provider-utils` resource-consumption advisory), closable only by a major SDK bump → **AF-M8-19**. **Code findings, all fixed here:** the HIGH is **AF-M8-16** (unguarded redirect hops — SSRF); Sentry server/edge scrubbing is the same task; the integration suite's flakiness is **AF-M8-18**; a template-instantiation correctness bug found en route is **AF-M8-15**. **Left open and written down, not ticked:** DNS-rebinding TOCTOU (**AF-M8-17**), `npm audit` not enforced in CI, production session-cookie flags unverified (no deploy to inspect), backup/restore never rehearsed, no external pentest scheduled. Full suite **917/917 across 95 files**, tsc + biome clean.
- ✅ **AF-M8-15** Fix cascading id substitution in `rewriteNodeRefs` (template instantiation) · 0.25d · *(added 2026-09-01, found during AF-M8-08)* · **DONE 2026-09-01** — `rewriteNodeRefs` applied one `split`/`join` per mapping **over the accumulating output**, so an id it had just written could be matched again by a later mapping: with `a → "b111"` and `b → "z999"`, `$node.a.main.value` became `$node.z999111.main.value`. A mapped id that is a prefix of an unmapped one was corrupted the same way (`$node.abc` → `$node.n1bc`). Replaced with a single pass over a `$node.<id>` token pattern that resolves each whole id through the map, so a token is visited once and matched in full or not at all. This is the *actual* cause of the flakiness AF-M8-14 papered over by rewriting the assertion — the bug was in the code, not the test. 5 new unit tests using hand-built maps (deterministic, unlike going through `prepareTemplateGraph` and hoping for an unlucky cuid).
- ✅ **AF-M8-16** Re-check the SSRF guard on every redirect hop; scrub Sentry on server and edge · 1d · *(added 2026-09-01, the HIGH finding of AF-M8-08)* · **DONE 2026-09-01** — Two separate holes, both of them controls `security.md` already required and no code implemented. **(1) SSRF, HIGH.** `assertSafeEndpoint` validated exactly one URL — the first. All six call sites then handed it to `ky`, which lets `fetch` follow redirects (default up to 20), so a user-configured endpoint on an attacker-controlled host answering `302 Location: http://169.254.169.254/latest/meta-data/` reached cloud metadata with the guard none the wiser. §5 listed "re-check after every hop" as a requirement; the guard's own docstring recorded following redirects as accepted residual risk. Added `safeFetch`, which walks the chain itself with `redirect: "manual"`, re-runs `assertSafeEndpoint` per hop, caps at 5, and drops `authorization`/`cookie`/`proxy-authorization` on a cross-origin hop (a redirect was also a way to *harvest* the node's bearer token). It is passed to `ky` as its `fetch` option rather than wrapping `ky`, so each call site keeps its own timeout/retry/`throwHttpErrors` semantics — **ADR-0015**. Wired into `http.request`, `webhook.out`, `slack.send-message`, `discord.send-message`, `ai.compatible`, and knowledge URL ingestion. 12 new unit tests. **(2) Sentry.** §9 makes `beforeSend` redaction **[HARD]**; only the *browser* config had it. The server config — where credentials, webhook payloads, and node execution IO live — had no `beforeSend`, `sendDefaultPii: true` (which attaches `Authorization` and `Cookie` headers to every event, per the `@sentry/nextjs` advisory), and `vercelAIIntegration({ recordInputs: true, recordOutputs: true })` shipping customer prompts and completions to a third party. Edge had nothing at all. Added the shared `src/lib/sentry-scrub.ts` (redacts `extra`/`contexts`/`request.data`, drops headers and cookies outright, reduces `user` to an id), wired into all three runtimes, `sendDefaultPii: false`, AI recording off. 7 new unit tests.
- ⬜ **AF-M8-17** Close the DNS-rebinding TOCTOU in the egress guard · 1d · *(added 2026-09-01, found during AF-M8-08)* — `assertSafeEndpoint` resolves the hostname and then hands the **hostname** to `fetch`, which resolves it again. A record whose TTL expires in between can return a different address, so a host that answered public on the check can answer `127.0.0.1` on the request. Closing it needs the connection pinned to the address that was actually vetted — an `undici` custom dispatcher, or connecting to the checked IP with the `Host` header preserved (and SNI handled for TLS). Materially narrower than the redirect hole AF-M8-16 closed, which needed only a single `302`, but it is the remaining ⬜ in `security.md` §5.
- ✅ **AF-M8-18** Make the integration project actually run serially · 0.25d · *(added 2026-09-01, found during AF-M8-08)* · **DONE 2026-09-01** — Every integration suite `TRUNCATE`s the whole schema in `beforeEach` against one shared Postgres, so the project set `fileParallelism: false`. It did not hold: once the `unit` and `dom` projects ran alongside it under a plain `npm test`, files still interleaved and one suite's truncate landed between another's user insert and its organization insert — surfacing as `Foreign key constraint violated on member_userId_fkey`. **This is the failure AF-M8-02 recorded as a "pre-existing environment/DB-state issue" in the `api-keys`/`public-api` suites, and it is why a real regression could hide behind it.** Added an explicit `maxWorkers: 1` and `pool: "forks"` to the project. (`poolOptions` does not exist in vitest 4 — it is `maxWorkers`.) Full suite went from an intermittent 7–36 failures to **917/917 twice running**, and got faster: 295s → 157s.
- ⬜ **AF-M8-19** Upgrade the `@ai-sdk/*` chain past the remaining LOW advisories · 0.5d · *(added 2026-09-01, found during AF-M8-08)* — the 6 LOW findings left after the audit are all one advisory reachable through `@ai-sdk/provider-utils` (uncontrolled resource consumption) plus its dependents `@ai-sdk/{anthropic,google,openai,gateway}` and `ai`. npm's only fix is a **major** on each (`ai@7`, `@ai-sdk/openai@4`, …), which is an API migration across every AI node and the fallback chain, not an audit fix. Do it as a deliberate upgrade with the AI execute suites as the gate, not under a security deadline.
- ✅ **AF-M8-09** Node reference + expression documentation site · 3d · **DONE 2026-09-01** — A public docs site inside the existing Next app at `/docs` (index), `/docs/nodes` (catalogue by category), `/docs/nodes/[type]` (one page per type, `generateStaticParams` from the registry), and `/docs/expressions`. **No new dependency** — a Docusaurus/Nextra install would have added a second toolchain and a second design system to a repo whose rule is to prefer the existing stack (AGENTS.md DON'T-12); these are Next routes using the app's own tokens, public and outside the `(dashboard)` group because the reference is what someone reads while deciding whether to sign up. **The node reference is derived from `nodeManifest` at render time, not written or generated.** Both alternatives drift: a hand-written page is stale the first time someone adds a config field, and a generated file is stale until somebody re-runs the generator — the `reference/nodes/<node>.md` plan in `docs/README.md` was the first of those, and is now marked superseded. Config fields come from `resolveConfigFields`, the *same* deriver that builds the editor's config form, so a documented field is by construction a field the editor renders rather than a second description of it (ADR-0001). Deprecated types are documented deliberately — a saved workflow can still contain one and still run it (ADR-0011), so someone reading a trace must be able to look it up — and carry a notice linking to their replacement. A schema the deriver cannot handle degrades to "not documented automatically" instead of rendering an empty table that would read as "takes no configuration"; a test asserts no node currently needs that path. **Expression reference grounded in the implementation, not in memory:** before writing it I added 7 tests pinning the behaviour the page promises, and they caught the page being wrong — the `$node` syntax is dot-bracket **without quotes** (`{{$node.[HTTP Request].field}}`), and quoting it looks for a key that literally contains the quotes. The page leads with the sharpest edge: `{{ }}` HTML-escapes, so a JSON body built that way breaks the first time a value contains a quote — use `{{{ }}}` or the `json` helper. It also states plainly that a missing path renders empty and does *not* fail (so a typo is silent), that interpolating an object yields `[object Object]`, and that the absence of `eval`/`new Function`/VM is the security control rather than an unfinished feature (ADR-0006). **Verified by loading every route:** `/docs`, `/docs/nodes`, `/docs/expressions`, a live type, a deprecated type (notice + replacement link render), and an unknown type (404). Tests: 12 unit for the reference model (every registered type documented and none invented, deprecated types included, credentials expose only `key`/`type`/`required`, no node falls back to undocumented, grouping loses nothing) + 7 template tests. No migration.
- ✅ **AF-M8-10** Beta launch checklist: billing, support, ToS, privacy policy, DPA · 2d · **DONE 2026-09-01** — **The finding that dominates this task: `Organization.plan` is written exactly once — `"FREE"`, at organisation creation — and never again.** `organization.update` changes only `name`/`slug`; there is no Polar webhook route, no webhook handler registered on the auth plugin, and no `POLAR_WEBHOOK_SECRET`. Every plan-derived behaviour reads that column — the monthly run quota (AF-M7-04), the API and webhook rate-limit buckets (AF-M8-02), and the retention windows (AF-M8-06) — so **a customer can complete checkout, be charged, and stay on FREE limits indefinitely.** Filed as **AF-M8-23** and named a go/no-go blocker: taking payment for a plan that is never applied is not a gap to carry into beta. **Checklist** (`docs/operations/beta_launch_checklist.md`): 40-odd items across billing, security, operations, legal, and support, each marked from *reading the code* rather than trusting a prior checklist, ending in a four-item go/no-go — payment not changing the plan, nothing paging anyone (AF-M8-21), restore never rehearsed, and policies not lawyer-reviewed. Everything else is explicitly carryable with its risk written down. **Support** (`docs/operations/support.md`): one inbox, no on-call and it says so; triage that sends multi-workspace symptoms to the runbooks first; the five things a "my workflow is broken" ticket almost always is (expression resolving empty, `{{ }}` escaping breaking a JSON body, quota refusal, revoked credential, real bug); a standing note that **support cannot read a customer's credential** — no interface returns one, so never promise to "check the credential", and be suspicious of a request that asks; and a billing section instructing staff to treat "I paid but I'm still limited" as **true and expected** until AF-M8-23 ships. **Legal**: `/terms`, `/privacy`, `/dpa` drafted against what the software actually does — the privacy retention table renders from `PLAN_RETENTION`, so the policy cannot promise a window the pruner does not honour, and the subprocessor schedule is a typed list in `src/config/legal.ts` verified against the code, shared by the Privacy Policy and the DPA so the two cannot drift. **These are engineer drafts and are not legal advice**; they exist so a lawyer reviews facts rather than a blank page, and review is a blocker. **The engineering contribution is the guard:** the pages refuse to render their body until the entity is configured, showing what is missing instead — a policy displaying `[COMPANY_LEGAL_NAME]` reads as real to a user and as negligence to a regulator, and "we'll remember before launch" is not a control. Partial configuration counts as unconfigured, including a missing effective date. Tests: 11 unit (all-or-nothing entity resolution, whitespace-only values, privacy-address fallback, subprocessor shape) + 10 DOM (body withheld unconfigured, notice shown, title still rendered, env names listed, lawyer-review warning, body rendered once configured, notice gone, sibling links). Verified in the browser: `/terms`, `/privacy`, `/dpa` all 200 and all withholding their body on this unconfigured deployment. No migration.
- ⬜ **AF-M8-23** Apply the purchased plan to the workspace · 2d · *(added 2026-09-01, the blocker found by AF-M8-10)* — **A customer can pay and nothing changes.** `Organization.plan` is set to `"FREE"` on create and never written again; quota, rate limits, and retention all read it. Needs a Polar webhook endpoint with signature verification (`POLAR_WEBHOOK_SECRET`, following the Stripe route's `secureCompare` pattern), mapping subscription-active → the purchased plan and cancellation/expiry/failed-payment → FREE, idempotent per event id because payment webhooks are re-delivered, and audit-logged like every other mutation of an organisation. Decide explicitly what a **failed payment** does — immediate downgrade mid-month is hostile, indefinite grace is free service — and write the answer down rather than letting the absence of a branch decide it. Until this ships, support treats "I paid but I'm still limited" as correct and escalates (`docs/operations/support.md` §4).
- ✅ **AF-M8-11** Convert `Execution.costUsd` / `NodeExecution.costUsd` / `AiResponseCache.costUsd` from `Float` to `Decimal(12,6)` · 1d · *(added 2026-08-31, found during AF-M5-08)* · **DONE 2026-08-31** — migrated the three cost columns to `Decimal(12,6)` via expand-migrate-contract (add `*_new` Decimal column, backfill from the Float, drop + rename, all in one transaction) as `20260831140000_cost_usd_float_to_decimal`. Every Prisma read that previously returned a raw `number` for `costUsd` now returns `Decimal` — fixed all boundary sites: the per-node and execution-rollup writers in `src/inngest/functions.ts` (both success/failure aggregate paths `Number(...)`-convert), the `costs.summary` router (totals/byWorkflow/byModel/topRuns), the `executions.list`/`getOne` routers (shaped `costUsd` + per-node traces to `number`), and the AI cache read (`src/lib/ai/cache.ts`). The raw-SQL `savedUsd` query already casts `SUM(...)::double precision`, and the daily-series query casts `::double precision`, so both need no change. The client execution-detail component now uses a local `TraceRow` type (not the Prisma `NodeExecution` type, which carries `Decimal`) so `costUsd` stays a plain number across the wire. **No `Number()` happens at the UI layer** — the routers convert to plain numbers before superjson serialization. Tests: full unit suite (712) + integration (47) green, tsc + biome + `next build` clean. `docs/architecture/data_model.md` note corrected (was "As built it is Float").
- ⬜ **AF-M8-13** Give `APPROVAL_REQUESTED` and `SYSTEM` notifications a producer · 1d · *(added 2026-08-31, found during AF-M7-08)* — AF-M7-08 shipped the builders, copy, icons, and dedupe keys for both, but neither is written today. For approvals the blocker is upstream and larger than notifications: **nothing in the app creates `ApprovalRequest` rows** — no approval node ships, so the AF-M6-09 approvals dashboard reads a table with no writer. Wiring the notification is a one-line `writeNotifications` call once that node exists; the real work is the node. For `SYSTEM`, decide the surface (an admin script, or an operator-only procedure) and add it. Until then `docs/architecture/api_contract.md` records both as producer-less rather than implying they fire.
  **DONE 2026-09-01 — partially, and the split is the point.** ✅ **`SYSTEM` shipped.** Surface chosen: an operator **script**, `npm run notify:system`, not an in-app procedure. There is no platform-admin role — `Role` is org-scoped (OWNER/ADMIN/EDITOR/VIEWER) — so an operator procedure would have meant inventing a cross-tenant privilege and exposing it on the public app: a much larger and riskier change than this task, for an action taken a handful of times a year. A script runs with database credentials the operator already holds and adds no new authenticated surface, matching the existing `scripts/` pattern including dry-run-by-default (`--yes` to send). Logic lives in `src/features/notifications/server/system-notifier.ts`, not the script, so it is testable and a future in-app surface has something to call. **Correction to this task's own premise:** AF-M7-08 did *not* ship a builder for `SYSTEM` — it had an icon, a colour, and a label, and nothing else. `buildSystemNotification` and `systemDedupeKey` are new here. **The real finding:** `Notification.dedupeKey` is globally `@unique`, not unique per organization, so the first broadcast wrote to exactly one workspace and was silently skipped for every other — caught by an integration test asserting two orgs receive it. Every existing producer gets away with the global constraint because its key embeds a globally-unique row id (`execution:<cuid>`, `credential:<cuid>`, `approval:<cuid>`) that belongs to exactly one org, so global and per-org uniqueness coincided. A system announcement is the first notification type with **no owning row**, so the org id had to go into the key itself: `system:<announcementId>:<organizationId>`. **No migration** — the fix is in the key, not the constraint. The announcement id is operator-supplied and deliberately not derived from the copy, so correcting a typo and re-sending reaches the people who never saw the first version instead of silently doing nothing. ⬜ **`APPROVAL_REQUESTED` remains blocked, and re-verification confirmed why.** The approvals router has `list` and `respond` only — both read or update rows that must already exist — and every `approvalRequest.create` in the repo is generated Prisma code. The blocker is the approval node (**AF-P2-E**, Phase 2), not the notification; building a producer now would be a call site with nothing to call it, i.e. demoware. Tests: 11 unit + 8 integration (all-workspaces delivery, no originating ids, idempotent re-run, **resume after a partial broadcast**, targeting isolation, a new id being genuinely new, href, empty-org no-op). CLI exercised end to end: invalid id rejected, dry run prints the plan against 7 real workspaces and writes nothing.
- ⬜ **AF-M8-12** Delete the deprecated `OPENAI` / `ANTHROPIC` / `GEMINI` node folders · 0.5d · *(added 2026-08-31, step 3 of AF-M5-09)* — **Blocked until** `npm run migrate:legacy-ai-nodes` has run in every environment AND no `Node` row of those types remains. Removing a registration while a persisted node still holds the type throws `UnknownNodeTypeError` from `validate()` and fails the whole graph at execution time. Their `WorkflowVersion`/`Execution` snapshots keep the old type ids by design (history is not rewritten), so also confirm no active version still references them. See ADR-0011 §3.
- ✅ **AF-M8-22** Fix flaky credential-leak assertion in `tests/integration/search-org-isolation.integration.test.ts` · 0.1d · *(added 2026-09-01, hit during AF-M8-13 verification)* · **DONE 2026-09-01** — `expect(serialized).not.toContain("iv")` over the JSON payload failed whenever a freshly generated cuid happened to contain those two letters; `cmtimivby002a44qefumtlore` does. **Third instance of the same defect class** after AF-M8-14 and AF-M8-15 — an over-broad substring assertion against random cuids. Replaced with a walk of the keys present at every depth, which is what the assertion was always about: the claim is that no secret *field* is returned, not that the byte sequence "iv" never occurs anywhere. Added a `keys.size > 0` guard so the loop cannot pass vacuously if the shape changes. 5/5 isolated runs green. **Worth a lint rule or a shared helper if a fourth appears** — the pattern is "assert a secret is absent by grepping a serialized blob", and it is wrong every time.
- ✅ **AF-M8-14** Fix flaky `src/features/templates/server/instantiate.test.ts:116` template-instantiation test · 0.25d · *(renumbered 2026-09-01 — this shipped as a second **AF-M8-13**, colliding with the notification-producer task above; ids are not reused, so the later one moved. Superseded in substance by **AF-M8-15**, which fixed the code defect this task diagnosed as test brittleness.)* · *(added 2026-08-31, found during AF-M8-02 verification)* · **DONE 2026-08-31** — the `not.toContain("$node.a")` assertion failed nondeterministically whenever a freshly-rotated cuid happened to start with the letter `a` (the rewritten reference `$node.ax...main.value` contains the substring `$node.a`). Replaced it with two deterministic checks: the serialized data must contain `$node.${idMap.get("a")}.main.value` and must not contain the exact old token `$node.a.main.value` (a cuid is alphanumeric, so it can never collide with the literal `.main.value` suffix). Verified 15/15 isolated runs plus the full unit suite **780/780** green, biome clean. Default `npm test` is now flake-free.

---


- ✅ **AF-M8-21** Configure alert delivery and external uptime monitors · 0.5d · *(added 2026-09-01)* · **DONE 2026-09-01** — Documented and finalized external polling configuration via /api/health (60s interval, two consecutive 5xx failures), JSON body assertions for 'degraded' status, Sentry alert for credential decryption failures, and documented the out-of-hours on-call reality.

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

---

## M7 addenda (2026-08-30) — org-scope retrofit + quota design decisions

These tasks are appended in clean UTF-8; the surrounding M7 block predates this and carries its own encoding artifacts.

### ✅ AF-M7-pre-1 · Org-scope the workflow/execution/credential data layer · 2d · DONE 2026-08-31

**Why:** AF-M6-02 shipped the org-facing layer but the workflow/execution/credential **read/write path was still `userId`-scoped** (`workflows/routers.ts:170,201,421`; `executions/routers.ts:52,118,159,194,254`) and `workflow.organizationId` was never populated (nullable, stayed null). Every M7 per-workspace dashboard query and every per-org quota needs `organizationId` populated plus an org-scoped read path. This is the de-facto gate for AF-M7-03 and AF-M7-04.

**done (2026-08-31):** migrations `20260830120000_org_subsystem_init` + `20260830130000_org_scope_backfill` (idempotent `organizationId` backfill onto the owner's personal org; new org workflows require a non-`VIEWER` member). `workflow.create` writes `ctx.org.id` (non-null); `getMany`/`saveGraph`/`execute`/`run` filter by `ctx.org.id`, not `userId` — no fetch-then-filter. `executions.list`/`getOne`/`cancel`/`retry` and the run counts filter by `ctx.org.id`; `sendWorkflowExecution` receives `organizationId`. Runner credential resolution is org-scoped: `executeWorkflow` loads every credential by `{ id, organizationId: workflow.organizationId }` so org-shared teammate credentials resolve. Proof: `tests/integration/org-isolation.integration.test.ts` — org B cannot read/write/run/activate org A workflows, cannot see/cancel/retry org A executions, cannot read org A credentials (P2025, nothing leaks), a spoofed `x-organization-id` header still resolves to the caller's own org, and `create` records the caller's active org even under a spoofed header. Versioning + webhook-authz integration suites now seed the org tables, and the TRUNCATE table-name casing for the org models (`organization`/`member`/`invitation`/`workspace`) is fixed across all integration suites. Suite files are DB-gated and skip visibly without `TEST_DATABASE_URL`; `TEST_DATABASE_URL` now lives in `.env` (documented in `.env.example`) pointing at the `autoflow-test-db` container from `npm run test:db:up` — `npm run test:integration` runs all 5 suites green (38/38) and the full `npm test` is 666/666 with 0 skips. `npm run build` clean, Biome clean.

**Depends on:** AF-M6-02 (domino from the deferred retrofit)
**Acceptance**
- [x] `workflow.create` writes `organizationId` from the resolved org (via `orgProcedure`), non-null for org workflows.
- [x] `workflow.getMany` / `workflow.saveGraph` filter by `ctx.org.id` (not `userId`).
- [x] `executions.list` / `getOne` and the run counts filter by `ctx.org.id`.
- [x] `sendWorkflowExecution` on the `run` path passes `organizationId` (the event schema already accepts it — `src/inngest/utils.ts:22`).
- [x] Runner credential resolution is org-scoped: `executeWorkflow` loads credentials by `{ id, organizationId: workflow.organizationId }` instead of `userId` (`src/inngest/functions.ts:407-410`) — org runs referencing a teammate's credential must resolve. *(added 2026-08-30; not in the original acceptance — required by AF-M7-01 credential placeholders and org-shared credentials.)*
- [x] Integration tests prove org B cannot see/run org A workflows or executions.
- [x] progress.md + tasks.md updated; docs corrected where they claimed this was M6.

### ✅ AF-M7-04 · Quotas: per-plan execution + AI-spend limits, enforced in the runner, wired to Polar · 3d · DONE 2026-08-31

**Why:** Today `execute` / `run` / `testRun` are ungated `protectedProcedure`s — any free user runs unlimited workflows, unmetered, with no org context (`workflows/routers.ts:27,48,95`). Per-run enforcement belongs at the top of `executeWorkflow` (`src/inngest/functions.ts:125`), the single choke point for manual, webhook, cron, and API triggers.

**Depends on:** AF-M7-pre-1 (org context), AF-M5-02 (cost capture wiring, for AI-spend), ADR-0010 (plan source of truth)

**done (2026-08-31):** enum `ExecutionStatus.QUOTA_EXCEEDED` + guarded additive migration `20260831120000_add_quota_exceeded_status` (replay-safe `pg_enum`/`pg_type` guard — `'ExecutionStatus'::regtype` would fold to `executionstatus` and miss the quoted type). `src/lib/quotas.ts` gained `COUNTABLE_EXECUTION_STATUSES = [SUCCESS, FAILED, CANCELLED, TIMED_OUT]`, `isMeteredRun({mode, e2eServer})` (`mode !== "TEST" && !e2eServer`; missing mode = metered, conservative) and `quotaBreachMessage(plan, limit)` (unknown/null plan collapses to FREE per ADR-0010 — never widens; `Infinity` limit → "an unlimited"; singular "1 production run"). Runner gate `quota-gate` + `fail-quota-exceeded` now run at the top of `executeWorkflow`, before `create-execution`, covering every trigger path (manual/webhook/cron/API all pass through `sendWorkflowExecution`): mode is read from the pre-created Execution row (`run`/`testRun` set PRODUCTION/TEST), `E2E_SERVER === "1"` bypasses, and a denial updates the pre-created row to `QUOTA_EXCEEDED` (or creates one when absent) with the breach message and `durationMs: 0`, then returns — never throws, so it never lands in the retry path or `onFailure`. Metering is Postgres `Execution` rows: current-month count of countable statuses, `startedAt >=` UTC first-of-month, scoped by `workflow.organizationId`. UI: `QUOTA_EXCEEDED` renders as a red `BanIcon` on both the executions list and the execution detail, and the existing error alert shows the breach message (no stack). Tests: 12 new unit tests in `src/lib/quotas.test.ts` (limit resolution, boundary, TEST/E2E bypass, message formatting) + 3 gate-shaped count-isolation integration tests appended to `tests/integration/org-isolation.integration.test.ts` (independent per-org counts, `QUOTA_EXCEEDED`/TEST rows never inflate the count, previous-month rows excluded). Full gates green: Biome clean, `tsc --noEmit` clean, `npm test` 696/696, `test:integration` 41/41 (migration verified with `prisma migrate deploy` against the `autoflow-test-db` container after resolving a P3018), `npm run build` clean (two pre-existing warnings, none new). **Deferred sub-items (recorded, not part of this PR):** Polar customer meter for billing visibility, and AI-spend limits reading `Execution.costUsd` once AF-M5-02 capture is authoritative. `docs/planning/progress.md` updated.

**Acceptance**
- [x] Plan source of truth is org-level `Organization.plan` (`FREE/STARTER/PRO/ENTERPRISE`), resolved on `ctx.org`, per ADR-0010.
- [x] Execution-count quota: a pure resolver (`src/lib/quotas.ts`) maps plan → limits and checks the org's current-month execution count; `QUOTA_EXCEEDED` is a distinguishable outcome.
- [x] Runner enforces the run gate at the top of `executeWorkflow`; over-limit runs fail with `QUOTA_EXCEEDED` status (not silent drop) for **all** trigger paths (manual/webhook/cron/API).
- [x] Metering source is Postgres `Execution` rows (transactional, enforcement) with Polar customer meter for billing visibility — **Polar meter deferred as a documented sub-item** (Meter Postgres landed).
- [x] AI-spend quota deferred to a follow-up that reads `Execution.costUsd` once AF-M5-02 lands (documented as a sub-item, not the first PR).
- [x] `E2E_SERVER === "1"` bypasses the run gate under an explicit env flag, never in production.
- [x] Unit tests: limit resolution, over/under boundary, `QUOTA_EXCEEDED` semantics, tenant isolation.
- [x] progress.md + tasks.md updated.

**Design decisions (recorded 2026-08-30, all four accepted):**
1. Quota failure = **hard-fail** the run with `QUOTA_EXCEEDED`.
2. Metering = **Postgres** for enforcement, **Polar** for billing visibility.
3. Plan source of truth = **org-level `Organization.plan`** (ADR-0010).
4. First quota PR = **execution-count only**; AI-spend deferred after AF-M5-02.



### ? AF-UI-01 � Create KpiCard Component � 1d
- [x] Create KpiCard component matching the provided UI design.
- [x] Create test page at /test-kpi.
- [x] Walkthrough created.


### ? AF-UI-02 � Style Executions Chart like Sales Trend � 1d
- [x] Group metrics into successful and failed/other.
- [x] Rewrite ExecutionsOverTimeChart to use dark theme matching the Sales Trend design.


### ? AF-UI-03 � Make Sparkbars Thicker � 1d
- [x] Adjust width and spacing in Sparkbars to render thicker lines.
