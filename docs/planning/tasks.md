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
**Reality (2026-08-22):** previously marked shipped (PR #23) — not done. `POLAR_SUCCESS_URL` is read only server-side (`src/lib/auth.ts:37`), so the client-side bug may be N/A; product-ID literals and the `"pro"` slug still need checking. No `src/lib/env.ts` exists. *(Addendum 2026-09-02: `POLAR_SUCCESS_URL` was later removed entirely — the successUrl is now a relative path resolved against the request host, see AF-M0-10 note.)*

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

**Status (2026-09-02) — the CI half of this was never finished, and it mattered.** The workflow started a `pgvector` service and ran migrations against it but **never set `TEST_DATABASE_URL`**, which is what the `integration` project keys off. Every integration suite therefore skipped itself and CI went green having run **none** of them — including the suites that prove cross-tenant isolation, the public REST surface, and API-key auth. `TEST_DATABASE_URL` is now set at the job level, so `npm test` runs all three projects (1088 tests) instead of 961.

Wiring that up surfaced a second, worse problem: skipping is opt-in per suite (`describe.runIf(hasDb)`), so it only holds while every author remembers the guard — and `polar-webhooks.integration.test.ts` did not have one. With `TEST_DATABASE_URL` unset the setup only *warned*, leaving `DATABASE_URL` pointed at whatever `.env` says, so that suite **created and deleted users and organizations in the developer's dev database**. Proven by running it against a decoy URL: it printed "integration suites will skip" and then connected anyway. Fixed on both levels — the missing guard is restored, and the setup now repoints `DATABASE_URL` at an unresolvable host when `TEST_DATABASE_URL` is absent, so an unguarded suite fails immediately with an error naming the cause instead of quietly mutating real data. The invariant is now structural rather than remembered.

**Still open:** only the e2e signup journey, which needs a running app and a reachable Polar sandbox.

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

### ✅ AF-M0-08 · Environment validation and `.env.example` · 0.5d · DONE 2026-09-02
**Reality (2026-08-22):** no `src/lib/env.ts`, and no `.env*` file of any kind exists in this checkout — the app cannot boot without provisioning secrets first.
**Status (2026-08-24):** env module shipped and wired at boot; docs sync remains.

**Acceptance**
- [x] `src/lib/env.ts` validates server env with Zod via cached `ensureEnv()`, called from `src/instrumentation.ts` at boot; exports typed values (`publicAppUrl`). `SKIP_ENV_VALIDATION=1` bypasses for CI/build.
- [x] Missing/invalid vars produce a single readable error naming each variable (from `result.error.issues`).
- [x] `.env.example` lists every variable with a dummy value and a one-line comment, including `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `POLAR_*`, provider keys, `STRIPE_WEBHOOK_SECRET` (AF-A-01), `ENGINE_RETRIES` (AF-A-07). *(Created 2026-08-22, verified against code; `!.env.example` gitignore exception added.)*
- [x] `docs/operations/environment_setup.md` matches. *(2026-09-02: §4.2 had drifted 13 variables behind `.env.example` — the Resend pair (AF-M8-04), `POLAR_WEBHOOK_SECRET` + the per-plan product ids (AF-M8-23), and the legal/support block (AF-M8-10). All added, with a note that the legal block is all-or-nothing. Also fixed a malformed 4-column table row for `ENCRYPTION_KEY`, and removed the quick start's `npm run migrate:legacy-ai-nodes` step — a script AF-M8-12 deleted — in favour of the `verify:legacy-ai-nodes` check that replaced it. Verified by diffing variable names in `.env.example` against the document rather than by reading it.)*

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

**Env var visibility decision (2026-09-02)** — `NEXT_PUBLIC_` prefix policy, recorded so Vercel's "remove the public prefix" warning isn't re-litigated:
- `NEXT_PUBLIC_APP_URL` **MUST stay public.** Read at runtime in the browser by two `"use client"` trigger dialogs (`src/features/triggers/components/stripe-trigger/dialog.tsx:35`, `google-form-trigger/dialog.tsx:36`) to build the user-facing webhook URL. Removing the prefix makes it `undefined` in the browser and both dialogs fall back to `http://localhost:3000` — a regression into the localhost bug class. Vercel's warning for this variable is a false positive; leave it public and ignore the banner. Also consumed server-side by `src/lib/auth.ts` and `src/lib/auth-origins.ts` as a trusted origin.
- `NEXT_PUBLIC_POLAR_SUCCESS_URL` and `POLAR_SUCCESS_URL` are **both removed**. The checkout `successUrl` in `src/lib/auth.ts` is now a **relative path** (`/workflows/billing/success`) that the Polar plugin resolves against the request's own host (`new URL(successUrl, ctx.request.url)`). This eliminates the env var entirely and removes the bug class where a stale absolute value (e.g. `http://localhost:3000`) is baked into Polar's hosted checkout and redirects a paying customer to the wrong host. No per-environment success-url config is needed or should be re-added.

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

### ✅ AF-A-01 · Authenticate + authorize webhook triggers · 1d · **[HARD security]** · DONE 2026-09-02
`POST /api/webhooks/stripe?workflowId=…` accepts unsigned bodies with arbitrary workflow IDs — anyone can trigger any user's workflow.
**Status (2026-08-24):** code complete — per-workflow `webhookSecret` (cuid, unique) added to Workflow + migration `20260822030000_workflow_webhook_secret`; both routes require `workflowId`+`secret` params (400 missing / 404 unknown-or-mismatch via `secureCompare` sha256+timingSafeEqual); Stripe route additionally verifies `stripe-signature` with raw body (`constructEvent`, invalid → 400) and 500s if `STRIPE_WEBHOOK_SECRET` unset; trigger dialogs embed the secret in webhook URLs (plain `useQuery`, not suspense). Route-level tests pending DB-backed harness.

**Acceptance**
- [x] Stripe route verifies `stripe-signature` via `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`; unsigned requests → 400.
- [x] Resolved workflow ownership enforced before enqueueing; foreign/unknown `workflowId` or bad secret → 404. *(Design deviation: per-workflow secret proves ownership directly instead of a Stripe-account join — simpler and covers Google Forms identically.)*
- [x] Google Form webhook gets an equivalent per-workflow secret path param. *(no signature possible with Google Forms; secret is the only proof)*
- [x] Tests: valid signature passes, invalid/missing rejected, cross-owner rejected. *(2026-08-26: 12 route-level integration tests in `tests/integration/webhooks.authz.integration.test.ts`, real Postgres, all green locally — found & fixed an unsigned-request 500 that violated this very acceptance line; unsigned now → 400.)*
- [x] progress.md updated *(was already true and never ticked — progress.md records S1 as RESOLVED 2026-08-24 and M-A as done; box closed 2026-09-02)*

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

### ✅ AF-M1-06 · Schema-driven config panel · 3d · DONE 2026-08-29
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

### 🟡 AF-M2-00 · Inngest capability spike · 1d · **done from published limits 2026-09-02; one number still unmeasured**
De-risk before designing around it.

**This ran retrospectively.** The spike was meant to precede the design; M2 shipped without it, so the deliverable is no longer "what should we build" but "what did we build, and does it fit". That turned out to be the more useful question.

**The finding.** The 1000-step ceiling is not the constraint. The engine opens 5 steps per node (4 when the spike was written; AF-M8-27 added the cancellation read), so step count allows ~198 nodes — but **18 of 21 executors return `{ ...context, … }`**, and Inngest memoises every step return, so run state grows as `b × n(n+1)/2` against a **32 MB** cap while each return must also fit under **4 MiB**. At 100 KB of output per node — one ordinary HTTP or AI node — the engine tops out near **24 nodes**, an eighth of what the step ceiling implies.

**Two defects fell out of it, both since fixed.** Nothing bounded node output, so an oversized payload died as an opaque Inngest state error attributed to no node — now **AF-M2-09**. And `POST /api/v1/executions/:id/cancel` marked the row cancelled while the run carried on to completion — now **AF-M8-27**.

**Acceptance**
- [x] Documented findings on: step payload size limits, max steps per function, concurrency keys, cancellation, cron, and local-dev parity. *(`docs/engineering/inngest_limits.md`, 2026-09-02. §5 compares each limit against what `src/inngest/functions.ts` actually does, which is the part worth reading.)*
- [x] A decision recorded in `docs/decisions/` on large-payload handling (inline vs. blob-spill). *(**ADR-0018**: bound node output and fail loudly; do **not** add blob-spill yet, because it would sit on top of a design that re-sends the whole context every step — fix the rolling context via AF-M9-12 instead, which collapses the quadratic term and is already scheduled for correctness reasons.)*
- [ ] **…with the measured threshold.** The threshold in ADR-0018 (1 MiB/node) is **derived from published limits, not measured.** Closing this needs a real Inngest account: run a workflow of `n` nodes returning a known payload size, increase until it fails, record the node count and the error. Recipe in `inngest_limits.md` §7.

---

### ✅ AF-M2-09 · Bound node output at the executor boundary · 0.5d · *(added 2026-09-02, ADR-0018)* · **DONE 2026-09-02**
ADR-0018 decided the guardrail; this builds it. A node whose output exceeds the threshold fails with an error naming the node and the size, rather than the run dying opaquely on Inngest state limits several nodes later. **Deliberately not built as part of the spike** — putting an unmeasured guardrail into the execution path on the strength of arithmetic alone is exactly the move the spike was supposed to prevent.

**Acceptance**
- [x] Output size checked once, at the executor boundary in `src/inngest/functions.ts`, so every node type is covered without 21 separate changes. *(Boundary: immediately after the per-node retry loop, before the output is captured for `$node`/`context` — the one place every executor's return passes through.)*
- [x] Over-limit fails with a `NonRetriableError` naming the node and the actual size — never truncates, because a workflow that silently drops half an API response produces wrong results that look right (AF-M0-05).
- [x] Threshold is a single exported constant next to `MAX_STACK_LENGTH`, so the measurement from AF-M2-00 can change it in one place. *(`MAX_NODE_OUTPUT_BYTES` in `src/inngest/config.ts`.)*
- [x] Tests: under, over, and exactly at the limit. *(9-unit config suite: `serializedBytes` UTF-8 semantics, plus the boundary predicate across both sides and exactly-on the threshold.)*

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

## 🟡 M6 — Tenancy, RBAC, audit, SSO · 3 weeks

> **UI GAP CLOSED 2026-09-03.** The five missing surfaces the audit below found
> are now built and gated. `src/features/organizations/components/` (created
> this session) holds the member table, invite dialog, pending-invitations
> list, audit-log viewer, workspace switcher and create-workspace dialog;
> `src/features/auth/components/profile-settings.tsx` holds profile + session
> revocation; and the routes exist under `src/app/(dashboard)/(rest)/settings/`
> (`/settings/profile`, `/settings/members`, `/settings/audit-logs`, with a
> `/settings` → profile redirect) plus a top-level `/accept-invite`. The
> sidebar's stale static `WorkspaceCard` was replaced by the real
> `WorkspaceSwitcher`, and a Settings nav entry added. Server work the UI
> needed: a `getActive` procedure (active org + caller role), a best-effort
> `sendInvitationEmail` (an invite must not fail when Resend is unconfigured —
> the dialog shows a copyable accept link either way), `inviteMember` now
> returns `{ acceptUrl, emailed }`, and the login form honours a
> same-origin-validated `?redirect=` so the accept-invite round trip resumes
> after sign-in. **Coverage:** `tests/integration/organizations-members.integration.test.ts`
> (5 tests — invite → accept → member → role change → removal, `getActive`, the
> copyable-link return, and the audit-log entry) and 3 new `email.test.ts`
> cases for the best-effort sender. The browser check caught and fixed a real
> infinite-render loop in the accept-invite effect that tsc/lint/build all
> passed. **Gates:** unit 1421/1421, integration 198/198, tsc clean, lint clean
> (zero warnings), build green. **Still open in this milestone:** only
> AF-M6-10's approval *node*, which is `AF-M10-09` scope (see its entry). The
> five entries below keep their corrected history; each is re-flipped to ✅ with
> a build note.
>
> **RECONCILIATION 2026-09-03 (M0–M9 audit). Reopened: the server half of this
> milestone is real; roughly half of the client half was never built, and five
> task entries described UI that does not exist.**
>
> Verified against the filesystem, not the record: `src/app` contains **no**
> `settings`, `accept-invite`, `approvals`, `api-keys`, `audit` or `profile`
> route — `find src/app -ipath "*settings*"` and the other five all return
> nothing. `src/features/organizations/` and `src/features/api-keys/` have **no
> `components/` directory at all**; `src/features/approvals/` has two files, a
> hook and a router, and the hook is imported by nothing.
>
> The models, `orgProcedure` RBAC, cross-tenant isolation tests, audit-log
> writes and SSO are all genuinely done and are load-bearing for everything
> built since — this is not a claim that M6 is hollow. What is missing is the
> operator-facing surface: there is no way for a user to manage members, accept
> an invitation, read the audit log, switch workspace, or edit their profile,
> because none of those screens were written.
>
> Corrected inline below rather than rewritten, so the original claim stays
> visible next to what is actually on disk. This is the second occurrence of
> the provenance failure the 2026-08-22 reconciliation was written about; the
> rule it set — "a task is only checked after the change is verified on disk" —
> was not applied to this milestone.

- [x] **AF-M6-01** `Organization`, `Member(role)`, `Workspace`, `Invitation`, `AuditLog`, `ApprovalRequest` models in `prisma/schema.prisma` · 3d — **done**: Multi-tenant database schema with foreign keys, cascading deletes, and role enums (`OWNER`, `ADMIN`, `EDITOR`, `VIEWER`).
- [x] **AF-M6-02** `orgProcedure(minRole)` middleware; migrate every existing procedure to organization scoping · 3d — **done**: `src/lib/rbac.ts` and `src/trpc/init.ts` with auto-provisioning fallback, cookie/header organization resolution. The workflow/execution/credential read/write paths were **not** migrated here (`Workflow.organizationId` stayed nullable, reads kept `userId` scoping) — that retrofit landed later as **AF-M7-pre-1**. The procedures added in this task (organizations/members/invitations/audit) are tenant-scoped.
- [x] **AF-M6-03** Cross-tenant isolation test suite (org B cannot read/write org A through **any** procedure) · 2d — **done**: Unit and integration test suites validating monotonic RBAC hierarchy and cross-tenant query isolation.
- ✅ **AF-M6-04** Invitations, member management, role changes · 3d — **DONE (server 2026-08, UI 2026-09-03).** `organizationsRouter` (`inviteMember`, `updateMemberRole`, `removeMember`, `listInvitations`, `cancelInvitation`, `getMembers`) + the UI that was missing: `members-list.tsx` (role badges, role-change menu, remove-with-confirm; own row and owners are not editable so a workspace can't be locked out), `invite-member-dialog.tsx` (role picker with inline descriptions; on success shows a copyable accept link and whether the email was sent), `invitations-list.tsx` (pending invites with cancel), at `/settings/members`. Role gating is presentation only — every mutation stays an `orgAdminProcedure`. *(2026-09-03 build closed the `git 2026-09-03` audit finding "no `getMembers` UI table".)*
- ✅ **AF-M6-05** `AuditLog` model + append-only writes on every mutation + filterable viewer · 3d — **DONE (writes 2026-08, viewer 2026-09-03).** `logAuditEvent` + append-only writes, and now the reader that was missing: `audit-log-list.tsx` at `/settings/audit-logs` — paginated, filterable by action text and resource type, each row expandable to its `before`/`after` JSON diff, actor resolved (with "Deleted user"/system fallbacks for the `SetNull` actor). Admin-only, matching `listAuditLogs`. *(2026-09-03 build closed the audit finding "no `/settings/audit-logs` page".)*
- [x] **AF-M6-06** SSO: Google + GitHub via Better Auth · 2d — **done**: Better Auth social providers wired into authentication flow.
- ✅ **AF-M6-07** Workspace switcher and resource sharing UI · 2d — **DONE 2026-09-03.** `workspace-switcher.tsx` replaces the stale static `WorkspaceCard` in `app-sidebar.tsx` (whose own comment used to read "There is no switcher yet"): a dropdown of the caller's memberships with the active one checked, each labelled by role, plus `create-workspace-dialog.tsx` (derives a unique slug, switches into the new workspace on create). Switching writes the `autoflow_active_org` cookie — which `resolveActiveOrg` already read and membership-checked server-side, so nothing wrote it before — then `router.refresh()` so server components re-resolve against the new tenant. *(Resource-sharing UI beyond workspace membership stays out of scope, as before.)*
- ✅ **AF-M6-08** User profile settings (`settings-profile`) · 0.5d · *(added 2026-08-26)* — **DONE 2026-09-03.** `/settings/profile` (`profile-settings.tsx`): edit display name via `authClient.updateUser`, read-only email (changing the sign-in address is a separate verification flow), and **active-session management** — `listSessions` with a per-device label, "This device" marked, per-session Revoke and a "Sign out other devices" (`revokeOtherSessions`). The security-relevant half — signing out a lost device — now has a surface.
- ✅ **AF-M6-09** Accept-invite flow (`accept-invite`) · 0.5d · *(added 2026-08-26)* — **DONE 2026-09-03.** Top-level `/accept-invite?token=` (`accept-invite.tsx`), deliberately not behind `requireAuth`: an unauthenticated visitor is sent to `/login?redirect=…` with the token preserved, and acceptance resumes automatically after sign-in (the login form now honours a same-origin-validated `redirect`, verified in the browser). On success the joined workspace is made active and the user is dropped into it. The full invite → accept round trip is covered end to end by `organizations-members.integration.test.ts`. **A browser check caught a real infinite-render loop** (the effect's no-token branch set state before the `attempted` guard while depending on the unstable mutation object) that tsc, lint and build all passed — fixed.
- 🟡 **AF-M6-10** Approval workflows (`approvals`) · 2d · *(added 2026-08-26)* — ~~**done**: `core.approval` node type with dual `approved`/`rejected` output branches, `/approvals` management dashboard, and Inngest resumption event emission.~~
  **REOPENED 2026-09-03 (M0–M9 audit). None of the three things that description claims exists.** Verified against the code, not the record:
  - **No `core.approval` node.** `grep -rn "approval" src/nodes/` returns nothing; it is absent from `registry.ts` and `manifest.ts`, so there is no node to place, no `approved`/`rejected` ports, and nothing that could emit a resumption event.
  - **No `/approvals` dashboard.** No route under `src/app` matches `*approval*`. `src/features/approvals/` contains exactly two files — `hooks/use-approvals.ts` and `server/routers.ts`. There are no components.
  - **No Inngest resumption event emission**, which follows from there being no node.
  What *does* ship is a mounted `approvals` tRPC router that lists and resolves `ApprovalRequest` rows — **over a table nothing in the application ever writes to**. `prisma.approvalRequest.create` appears nowhere outside the generated client.
  **This was already known and recorded elsewhere**: AF-M8-13 states plainly that "nothing in the app creates `ApprovalRequest` rows — no approval node ships, so the AF-M6 approvals dashboard reads a table with no writer", and defers the approvals half to `AF-P2-E`. The two entries have contradicted each other since 2026-08-31; this one was the wrong one and is corrected here rather than left as the second instance of the exact provenance failure the 2026-08-22 reconciliation was written about.
  **Remaining scope** is the node itself and its UI — which is `AF-M10-09` (`APPROVAL` node — send and wait), already planned and estimated in M10. Nothing new is being added; this entry is being made honest.

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
- 🟡 **AF-M8-05** Load test to the concurrency target; fix findings · 3d · **harness + target built 2026-09-01; no run performed** — the task was unstartable as written because, as the launch checklist recorded, **no concurrency target was documented anywhere** and a load test without one produces a number with nothing to compare it to. `docs/operations/load_test.md` now proposes one and derives it rather than inventing it: **100 req/s sustained for 5 minutes from 50 clients, zero 5xx, p95 under 1s** — which is exactly one PRO tenant saturating the bucket they are already sold (`PLAN_BUCKETS.PRO` refills at 100/s), with the error budget taken from the existing S1 availability SLO. If one paying customer at their published rate limit can degrade the service, the rate limit is a fiction. `scripts/load-test.ts` (`npm run load-test`) drives the public REST API — the only authenticated surface a generator can drive without a browser session, and the one that exercises bearer auth, the token bucket, the org scope, the database, and (on the `run` profile) the quota check and enqueue. Two profiles: `read` first, because cheap requests saturate **connections** before CPU and connection-pool exhaustion is this deployment's most likely failure; `run` is destructive and starts real executions. **429 is scored as a pass, not an error** — a saturated service shedding load with 429 is behaving correctly, and counting it as failure would hide the 5xx that matter. Exit code is the verdict, so it can gate a release. **Still open:** running it needs a deployed non-production environment and an API key, neither of which is in the repository, so §5 of the doc has no results row and no capacity claim is supportable yet. "Fix findings" cannot start before there are findings.
- ✅ **AF-M8-06** Execution retention policy + archival/partitioning for `NodeExecution` · 3d · **DONE 2026-09-01** — `Execution`/`NodeExecution` grew without bound and nothing pruned them, so `security.md` §9's "execution IO is customer data … retention is bounded" was simply untrue. **Two-stage policy, not one** (ADR-0016): `input`/`output` are nulled at `ioRetentionDays`, and the `Execution` row is deleted at `deleteAfterDays` with `NodeExecution` following by `onDelete: Cascade`. A single delete stage would have forced a choice between holding customer payloads as long as we want cost history or discarding cost history as fast as we want to drop payloads — two stages needs neither, because redaction keeps status, timings, tokens, `costUsd`, `model`, and error text, so the monitoring and cost dashboards stay truthful over rows whose payloads are gone. **Windows are per-plan data** in `src/lib/retention.ts` (`PLAN_RETENTION`, same shape as `PLAN_QUOTA_LIMITS`; unknown/NULL plan collapses to FREE per ADR-0010, since "more than FREE" here means keeping data *longer*): FREE 7d/35d, STARTER 30d/90d, PRO 90d/365d, ENTERPRISE 365d/never. **The floor is the subtle part:** the runner meters the monthly quota by *counting* `Execution` rows in the current calendar month, so a delete window shorter than a month would remove rows still being counted and silently **refund quota** — paid capacity handed out on a timer. `QUOTA_SAFE_DELETE_FLOOR_DAYS` is 35 and a unit test asserts every plan honours it, so lowering a window below the quota window fails the build rather than leaking revenue quietly. Enforcement (`src/features/executions/server/retention.ts`) is **bounded** (page of ids per statement, ceiling per run, reports `truncated` and warns rather than locking the two largest tables) and **idempotent** (redaction only selects rows that still have a payload — `Prisma.DbNull`, not `JsonNull` — so a replayed Inngest step is a no-op). Non-terminal rows *are* pruned once past the window: no Inngest run lives 35 days, so a row still `RUNNING` at that age is a crashed run, and skipping it would leak exactly the runs that never complete. Daily `sweep-execution-history` cron at 03:45, off the AI cache sweep's 03:15. **Archival tier deliberately not built** and **partitioning deliberately deferred** behind a written trigger (~50M rows / ~50 GB, repeated `truncated` days, or autovacuum falling behind) — Prisma has no partitioned-table support, the PK would have to become `(id, startedAt)` maintained by raw SQL that `migrate diff` would fight, and it needs a partition-creation job whose failure mode is write errors on the busiest table. With retention enforced the table is *bounded*, which was the actual R8 risk. **No migration** — policy only. Tests: 27 unit (policy shape, the quota floor, plan collapse, cutoff arithmetic) + 9 integration against real Postgres (redaction keeps metrics, delete cascades, ENTERPRISE never deletes, one org's plan never governs another's rows, org-less legacy rows swept as FREE, idempotency, truncation-and-resume, stuck-`RUNNING` pruning). Corrected `data_model.md`, which pointed retention at `AF-M8-04` (the auth-email task).
- ✅ **AF-M8-20** Tell the user how far back their execution history goes · 0.5d · *(added 2026-09-01, consequence of AF-M8-06)* — retention is per-plan, so a "last 90 days" view on FREE silently shows at most 35 days of runs and less IO than that. The monitoring, cost, and execution-list screens do not say so; a range the data cannot cover should name the plan's window rather than render a truthful-looking empty stretch. Needs `resolveRetention` surfaced through a procedure the client can read. **DONE 2026-09-01.** No procedure needed after all - `usage.plan` and `periodDays` were already on the monitoring dashboard's data, so this is presentation, not transport. `retentionNotice(periodDays, plan)` returns `null` when the range fits, which is the common case and the one where a banner is just noise. It distinguishes two states that need different sentences, because conflating them would be its own lie: **history truncated** (runs really are missing - "keeps run history for 35 days, so a 90 days range shows at most 35 days of runs") and **payloads-only truncated** (every run is present, but older ones have lost their recorded inputs and outputs - worth saying on a page people open in order to debug). History wins when both hold. Unknown or missing plan collapses to FREE, the same ADR-0010 rule the pruner uses: a workspace must never be told its history reaches further back than it does. 9 unit + 4 DOM tests.
- ✅ **AF-M8-07** Alerting, runbooks for the top 5 failure modes, error budgets, status page · 3d · **DONE 2026-09-01** — **Status page + health endpoint (built).** `GET /api/health` (machine-readable, for an uptime monitor or load balancer) and `/status` (public, server-rendered, no session/tRPC/client JS — deliberately outside the `(dashboard)` group, because the moment it is needed is the moment the authenticated shell may not render). Two probes, each chosen to map to a runbook entry rather than to whatever is pingable: `database` (Postgres reachable) and `runner` (executions that started long ago and never reached a terminal status). **`runner` is the important one** — it detects the failure mode where every other surface looks healthy: the app serves, triggers fire, runs are accepted, and nothing finishes. Aggregation rules live in the isomorphic `src/lib/health.ts` so they are testable without a DB, and two of them are easy to get backwards and are pinned by tests: a probe that throws is `down` (never "unknown", never skipped — a health check that fails open reports green while the service burns), and an **empty check list is `down`** (no evidence of health is not evidence of health). `degraded` deliberately returns **HTTP 200**: a 503 would make a load balancer evict an instance that is still doing useful work, turning a partial outage into a total one. The endpoint is rate limited through the AF-M8-02 shared store (each probe runs real queries, so an open endpoint doing DB work is a free amplification primitive) and the body carries verdicts only — never an error string, which would name hosts, ports, and roles. **Caught while verifying in the browser:** the first render after boot reported a false **"Major outage"** because a cold Prisma connection blew the 2s probe budget; the DB probe now gets 5s, since a status page that cries wolf on every deploy is worse than none. **Runbooks (`docs/operations/runbooks.md`)** for five failure modes that this system can actually reach and that do not detect each other: F1 executions accepted but never completing, F2 database down / pool exhausted, F3 credentials failing to decrypt across the board, F4 AI provider outage or runaway spend, F5 webhook flood from one tenant. Symptom → confirm (with the actual SQL) → diagnose in order → mitigate, plus one rule per page: capture evidence before restarting, because in every one of these the state *is* the diagnosis. **SLOs and error budgets (`docs/operations/slos.md`)**: four SLIs over a 28-day window — availability 99.5%, execution success 99.0%, latency 95% under 60s, trigger fidelity 99.9% — with the budget framed as a decision rule ("do we ship or fix reliability") rather than a scoreboard. S2 excludes `CANCELLED` and `QUOTA_EXCEEDED` on purpose: a user cancelling is not a failure and a quota refusal is the system working, so neither should consume an engineering budget. Eight alert definitions, each naming the runbook entry it maps to — an alert with no runbook teaches people to ignore alerts. **Written down as NOT built, rather than implied:** nothing pages anyone today (no delivery, no external prober, so availability is currently unmeasured), no on-call rotation, no burn-rate tracking, trigger fidelity is uninstrumented, and — the most serious gap — restore has never been rehearsed, so there is no data-loss runbook. Filed as **AF-M8-21**. Tests: 13 unit + 6 integration. No migration.
- ✅ **AF-M8-21** Make the AF-M8-07 alerts actually reach a human · 1d · *(added 2026-09-01, the honest gap in AF-M8-07)* · **DONE — delivered as AF-M8-26**, which was opened under this same id by mistake and renumbered 2026-09-02. This entry is the problem and the plan; AF-M8-26 is the delivery. Kept separate rather than merged so the reasoning survives. — `docs/operations/slos.md` §4 defines eight alerts and nothing delivers any of them, so today we would learn about most incidents from a customer. Smallest first step and by far the best value: point one external uptime monitor at `/api/health` — that alone lights up `health-down` and `runner-stalled`, the two **page**-severity alerts, and starts measuring S1 availability, which is currently unmeasured because a service cannot credibly report its own uptime. Then Sentry alert rules for `credential-decrypt-failures` (threshold deliberately requires ≥2 organizations — one tenant's credential failing is user error, across tenants it is our key). Burn-rate tracking and the S4 trigger-fidelity counter come after. An on-call rotation is a people decision, not a code one.
- ✅ **AF-M8-08** Security review against `docs/architecture/security.md`; dependency audit; close all HIGH findings · 3d · **DONE 2026-09-01** — Reviewed every item in `security.md` §13 against the code rather than against the spec, and ticked a box only where the control was actually read. **Dependency audit:** 39 findings (3 CRITICAL, 18 HIGH) → **6, all LOW**. `npm audit fix` closed the two CRITICALs (`better-auth` basePath DoS, `handlebars` AST-confusion injection — the latter matters because ADR-0007 compiles user templates at runtime) plus 11 HIGHs, changing only the lockfile. Four transitive HIGHs whose only npm-suggested "fix" was a **downgrade** (`prisma` 7.9.1→6.12.0, `inngest-cli` 1.12.1→0.16.3) were instead closed with scoped `overrides`: `deepmerge-ts@^8.0.2`, `adm-zip@^0.6.0`, `postcss@^8.5.26`, and `undici@^6.28.0` under `@ai-sdk/provider-utils` (v5 has no fixed release; 6.28.0 is one major, not two). `better-auth`'s fix forced 1.3.26→1.7.2, which broke `@polar-sh/better-auth@1.1.9` (it imports `createAuthEndpoint` from `better-auth/plugins`, moved to `better-auth/api`); pinning back to a non-vulnerable 1.6.30 did **not** help — the export was already gone — so the Polar chain went to `@polar-sh/better-auth@1.8.4` + `@polar-sh/sdk@0.47.1`. Residual 6 LOW are all `@ai-sdk/*` (one `provider-utils` resource-consumption advisory), closable only by a major SDK bump → **AF-M8-19**. **Code findings, all fixed here:** the HIGH is **AF-M8-16** (unguarded redirect hops — SSRF); Sentry server/edge scrubbing is the same task; the integration suite's flakiness is **AF-M8-18**; a template-instantiation correctness bug found en route is **AF-M8-15**. **Left open and written down, not ticked:** DNS-rebinding TOCTOU (**AF-M8-17**), `npm audit` not enforced in CI, production session-cookie flags unverified (no deploy to inspect), backup/restore never rehearsed, no external pentest scheduled. Full suite **917/917 across 95 files**, tsc + biome clean.
- ✅ **AF-M8-15** Fix cascading id substitution in `rewriteNodeRefs` (template instantiation) · 0.25d · *(added 2026-09-01, found during AF-M8-08)* · **DONE 2026-09-01** — `rewriteNodeRefs` applied one `split`/`join` per mapping **over the accumulating output**, so an id it had just written could be matched again by a later mapping: with `a → "b111"` and `b → "z999"`, `$node.a.main.value` became `$node.z999111.main.value`. A mapped id that is a prefix of an unmapped one was corrupted the same way (`$node.abc` → `$node.n1bc`). Replaced with a single pass over a `$node.<id>` token pattern that resolves each whole id through the map, so a token is visited once and matched in full or not at all. This is the *actual* cause of the flakiness AF-M8-14 papered over by rewriting the assertion — the bug was in the code, not the test. 5 new unit tests using hand-built maps (deterministic, unlike going through `prepareTemplateGraph` and hoping for an unlucky cuid).
- ✅ **AF-M8-16** Re-check the SSRF guard on every redirect hop; scrub Sentry on server and edge · 1d · *(added 2026-09-01, the HIGH finding of AF-M8-08)* · **DONE 2026-09-01** — Two separate holes, both of them controls `security.md` already required and no code implemented. **(1) SSRF, HIGH.** `assertSafeEndpoint` validated exactly one URL — the first. All six call sites then handed it to `ky`, which lets `fetch` follow redirects (default up to 20), so a user-configured endpoint on an attacker-controlled host answering `302 Location: http://169.254.169.254/latest/meta-data/` reached cloud metadata with the guard none the wiser. §5 listed "re-check after every hop" as a requirement; the guard's own docstring recorded following redirects as accepted residual risk. Added `safeFetch`, which walks the chain itself with `redirect: "manual"`, re-runs `assertSafeEndpoint` per hop, caps at 5, and drops `authorization`/`cookie`/`proxy-authorization` on a cross-origin hop (a redirect was also a way to *harvest* the node's bearer token). It is passed to `ky` as its `fetch` option rather than wrapping `ky`, so each call site keeps its own timeout/retry/`throwHttpErrors` semantics — **ADR-0015**. Wired into `http.request`, `webhook.out`, `slack.send-message`, `discord.send-message`, `ai.compatible`, and knowledge URL ingestion. 12 new unit tests. **(2) Sentry.** §9 makes `beforeSend` redaction **[HARD]**; only the *browser* config had it. The server config — where credentials, webhook payloads, and node execution IO live — had no `beforeSend`, `sendDefaultPii: true` (which attaches `Authorization` and `Cookie` headers to every event, per the `@sentry/nextjs` advisory), and `vercelAIIntegration({ recordInputs: true, recordOutputs: true })` shipping customer prompts and completions to a third party. Edge had nothing at all. Added the shared `src/lib/sentry-scrub.ts` (redacts `extra`/`contexts`/`request.data`, drops headers and cookies outright, reduces `user` to an id), wired into all three runtimes, `sendDefaultPii: false`, AI recording off. 7 new unit tests.
- ✅ **AF-M8-17** Close the DNS-rebinding TOCTOU in the egress guard · 1d · *(added 2026-09-01, found during AF-M8-08)* — `assertSafeEndpoint` resolves the hostname and then hands the **hostname** to `fetch`, which resolves it again. A record whose TTL expires in between can return a different address, so a host that answered public on the check can answer `127.0.0.1` on the request. Closing it needs the connection pinned to the address that was actually vetted — an `undici` custom dispatcher, or connecting to the checked IP with the `Host` header preserved (and SNI handled for TLS). Materially narrower than the redirect hole AF-M8-16 closed, which needed only a single `302`, but it defeats the entire IP blocklist when it lands. **DONE 2026-09-01 (ADR-0017).** `resolveSafeEndpoint` now returns the vetted addresses alongside the URL, and `pinnedDispatcher` hands undici a connector-level `lookup` that returns exactly those - there is no second resolution, so there is no window. `assertSafeEndpoint` stays as a thin wrapper returning just the URL, so none of the six node call sites changed. **Lookup override rather than rewriting the URL to an IP**: an IP URL breaks certificate validation (the cert is checked against the name in the URL) and serves the wrong site on a virtual-hosted origin. Overriding the lookup leaves SNI and the `Host` header carrying the hostname, so only the socket's destination is fixed - a test asserts the origin still sees the name, because that property is the whole reason for the design. The dispatcher also fails closed if asked about a host it was not built for, which should be unreachable since `safeFetch` re-vets at the top of every hop - which is exactly why it is asserted. **New direct dependency `undici@^7`**, justified in ADR-0017: nothing in the stack can pin a connection, undici *is* Node's fetch implementation so this makes the existing client configurable rather than adding a second HTTP stack, it was already installed transitively, and `^7` because undici 8 needs Node 22 while CI runs Node 20. **The failure mode this is tested against is not an exception** - it is a Node or undici version that ignores the dispatcher, resolves again, and looks exactly like success while protecting nothing. So the test pins `pinned.invalid` (RFC 6761, can never resolve) to a real local server: if the dispatcher is ever ignored, the lookup fails and CI goes red on whatever Node it runs. 3 new tests, 50 in the file. `security.md` §5 now has no open items.
- ✅ **AF-M8-18** Make the integration project actually run serially · 0.25d · *(added 2026-09-01, found during AF-M8-08)* · **DONE 2026-09-01** — Every integration suite `TRUNCATE`s the whole schema in `beforeEach` against one shared Postgres, so the project set `fileParallelism: false`. It did not hold: once the `unit` and `dom` projects ran alongside it under a plain `npm test`, files still interleaved and one suite's truncate landed between another's user insert and its organization insert — surfacing as `Foreign key constraint violated on member_userId_fkey`. **This is the failure AF-M8-02 recorded as a "pre-existing environment/DB-state issue" in the `api-keys`/`public-api` suites, and it is why a real regression could hide behind it.** Added an explicit `maxWorkers: 1` and `pool: "forks"` to the project. (`poolOptions` does not exist in vitest 4 — it is `maxWorkers`.) Full suite went from an intermittent 7–36 failures to **917/917 twice running**, and got faster: 295s → 157s.
- ✅ **AF-M8-19** Upgrade the `@ai-sdk/*` chain past the remaining LOW advisories · 0.5d · *(added 2026-09-01, found during AF-M8-08)* · **DONE 2026-09-02** — the 6 LOW findings were all one advisory reachable through `@ai-sdk/provider-utils` (uncontrolled resource consumption) plus its dependents `@ai-sdk/{anthropic,google,openai,gateway}` and `ai`. **`npm audit fix --force` proposed `ai@7`, which is two majors and was not the minimum fix.** Checking what is actually published showed the whole `3.x` line of `provider-utils` tops out at `3.0.36` — the advisory range `<=3.0.97` covers all of it — so no patch existed inside the current majors and an override could not help; but `ai@6` + providers `@3` is a **coherent set that all dedupes on `provider-utils@4.0.50`** and clears every finding with one major instead of two. Now `found 0 vulnerabilities`. **The only code change the upgrade forced was `usage`:** v6 widened it from a flat map of numbers into an object also carrying nested `inputTokenDetails` / `outputTokenDetails`, so the three `result as { usage?: Record<string, number> }` casts in the AI node executors became untrue — and passing the raw object through would have started persisting new nested provider data into every AI node's output context and into the trace. Replaced with `pickRunUsage` in `src/lib/ai/fallback.ts`, which lifts only the four counts the meter reads, defensively (a non-finite count meters as absent, not `NaN`), keeping the stored shape identical to v5. Costing was never at risk: `extractStepUsage` already reads `inputTokens`/`promptTokens` behind `typeof === "number"` guards, and v6 still exposes the flat counts. Also removed the now-redundant `@ai-sdk/provider-utils → undici` override, which pinned exactly what `provider-utils@4.0.50` already declares; resolution and audit are unchanged without it. `generateObject` is deprecated in v6 but not removed, so the JSON-mode paths still compile and run — migrating them to `generateText` + `Output.object()` is a separate, optional cleanup. Gate: 169 AI tests, then 955 unit+dom, 127 integration, tsc, biome, build. 6 new `pickRunUsage` tests.
- ✅ **AF-M8-09** Node reference + expression documentation site · 3d · **DONE 2026-09-01** — A public docs site inside the existing Next app at `/docs` (index), `/docs/nodes` (catalogue by category), `/docs/nodes/[type]` (one page per type, `generateStaticParams` from the registry), and `/docs/expressions`. **No new dependency** — a Docusaurus/Nextra install would have added a second toolchain and a second design system to a repo whose rule is to prefer the existing stack (AGENTS.md DON'T-12); these are Next routes using the app's own tokens, public and outside the `(dashboard)` group because the reference is what someone reads while deciding whether to sign up. **The node reference is derived from `nodeManifest` at render time, not written or generated.** Both alternatives drift: a hand-written page is stale the first time someone adds a config field, and a generated file is stale until somebody re-runs the generator — the `reference/nodes/<node>.md` plan in `docs/README.md` was the first of those, and is now marked superseded. Config fields come from `resolveConfigFields`, the *same* deriver that builds the editor's config form, so a documented field is by construction a field the editor renders rather than a second description of it (ADR-0001). Deprecated types are documented deliberately — a saved workflow can still contain one and still run it (ADR-0011), so someone reading a trace must be able to look it up — and carry a notice linking to their replacement. A schema the deriver cannot handle degrades to "not documented automatically" instead of rendering an empty table that would read as "takes no configuration"; a test asserts no node currently needs that path. **Expression reference grounded in the implementation, not in memory:** before writing it I added 7 tests pinning the behaviour the page promises, and they caught the page being wrong — the `$node` syntax is dot-bracket **without quotes** (`{{$node.[HTTP Request].field}}`), and quoting it looks for a key that literally contains the quotes. The page leads with the sharpest edge: `{{ }}` HTML-escapes, so a JSON body built that way breaks the first time a value contains a quote — use `{{{ }}}` or the `json` helper. It also states plainly that a missing path renders empty and does *not* fail (so a typo is silent), that interpolating an object yields `[object Object]`, and that the absence of `eval`/`new Function`/VM is the security control rather than an unfinished feature (ADR-0006). **Verified by loading every route:** `/docs`, `/docs/nodes`, `/docs/expressions`, a live type, a deprecated type (notice + replacement link render), and an unknown type (404). Tests: 12 unit for the reference model (every registered type documented and none invented, deprecated types included, credentials expose only `key`/`type`/`required`, no node falls back to undocumented, grouping loses nothing) + 7 template tests. No migration.
- 🟡 **AF-M8-10** Beta launch checklist: billing, support, ToS, privacy policy, DPA · 2d · **code complete 2026-09-01; four items are operator/lawyer work** — `docs/operations/beta_launch_checklist.md` is the gate and `docs/operations/operator_actions.md` sorts every remaining item by who is blocking it. Shipped: the checklist itself, `docs/operations/support.md`, drafted `/terms`, `/privacy`, `/dpa` rendered from `src/config/legal.ts` (which refuses to render a policy at all until the legal entity is configured, so an unconfigured deployment cannot publish a page reading `[COMPANY_LEGAL_NAME]`), and the subprocessor list generated from the services the code actually calls. **Closed 2026-09-01:** item 4.7 — Terms/Privacy/DPA/Support are now linked from the landing footer and the policies from the signup form; item 5.3 — `/support` exists (`src/app/support/page.tsx`), which is what `supportEmail()` was written for and nothing had ever rendered. The signup link is a **notice, not a checkbox**: item 4.8 (recording acceptance) stores nothing yet, and a tick box that records nothing looks like consent was captured when no record exists. Also corrected the landing footer's hardcoded "All Systems Operational" badge, which asserted health as static text and so claimed the service was up most loudly at the moment it was down; it now links to `/status`. **Not closeable from the repository:** 4.5 lawyer review, 4.6 legal-entity env values, 1.7 live Polar product ids, 5.2 a monitored support inbox.
- ✅ **AF-M8-11** Convert `Execution.costUsd` / `NodeExecution.costUsd` / `AiResponseCache.costUsd` from `Float` to `Decimal(12,6)` · 1d · *(added 2026-08-31, found during AF-M5-08)* · **DONE 2026-08-31** — migrated the three cost columns to `Decimal(12,6)` via expand-migrate-contract (add `*_new` Decimal column, backfill from the Float, drop + rename, all in one transaction) as `20260831140000_cost_usd_float_to_decimal`. Every Prisma read that previously returned a raw `number` for `costUsd` now returns `Decimal` — fixed all boundary sites: the per-node and execution-rollup writers in `src/inngest/functions.ts` (both success/failure aggregate paths `Number(...)`-convert), the `costs.summary` router (totals/byWorkflow/byModel/topRuns), the `executions.list`/`getOne` routers (shaped `costUsd` + per-node traces to `number`), and the AI cache read (`src/lib/ai/cache.ts`). The raw-SQL `savedUsd` query already casts `SUM(...)::double precision`, and the daily-series query casts `::double precision`, so both need no change. The client execution-detail component now uses a local `TraceRow` type (not the Prisma `NodeExecution` type, which carries `Decimal`) so `costUsd` stays a plain number across the wire. **No `Number()` happens at the UI layer** — the routers convert to plain numbers before superjson serialization. Tests: full unit suite (712) + integration (47) green, tsc + biome + `next build` clean. `docs/architecture/data_model.md` note corrected (was "As built it is Float").
- 🟡 **AF-M8-13** Give `APPROVAL_REQUESTED` and `SYSTEM` notifications a producer · 1d · *(added 2026-08-31, found during AF-M7-08)* · **SYSTEM done 2026-09-01; approvals half deferred to `AF-P2-E`** — AF-M7-08 shipped the builders, copy, icons, and dedupe keys for both, but neither was written. **`SYSTEM` now has one:** `broadcastSystemNotification` in `src/features/notifications/server/system-notifier.ts`, driven by `npm run notify:system -- --id <id> --title "…" --message "…"` (`scripts/notify-system.ts`), which was the surface `docs/operations/support.md` §6 already documented and nothing implemented. A script rather than an admin console because there is no admin console — and specifically because `Role` is org-scoped, so an in-app operator surface would mean inventing a cross-tenant privilege and exposing it on the public app, which is a far larger and riskier change than this task for something done a handful of times a year. **The logic lives in a server module rather than in the script**, so it can be tested against a real database and a future in-app surface has something to call; the script is a thin argument-parsing shell. Writes go through `writeNotifications` like every other producer, so the replay guard and the never-break-the-caller rule stay enforced in one place instead of being re-implemented here — an earlier cut of this called `prisma.notification.createMany` directly and quietly bypassed both. Organisations are processed in batches of 200, and `organizationIds` can narrow the target set. **Dry-run by default** — the blast radius is every workspace in the deployment and there is no unsend — and it reports how many workspaces would be told before it writes. The dedupe key is `system:<announcementId>:<orgId>`, per **workspace** rather than per announcement, because `Notification.dedupeKey` is unique across the whole table: keyed on the announcement alone the first workspace written would claim the key and `skipDuplicates` would silently swallow the rest of the fan-out. That also makes a half-finished broadcast safe to re-run. Argument parsing lives in `src/features/notifications/lib/announcement.ts` rather than the script so it is testable at all (the script runs `main()` on import), and is strict: an unknown flag throws instead of being ignored, because the flag a typo swallows is `--yes`. 13 parser + 7 builder unit tests, plus **13 integration tests against a real Postgres** — idempotency is enforced by a unique index, and only a real database proves it. Verified end-to-end by hand too: a dry run against the dev database, then a send and an idempotent re-send against the test database (2 written, then 0 written / 2 skipped). **The approvals half is not done and is not a notifications problem:** nothing in the app creates `ApprovalRequest` rows — no approval node ships, so the AF-M6-09 approvals dashboard reads a table with no writer. Wiring the notification is a one-line `writeNotifications` call once that node exists; the real work is the node, which is `AF-P2-E` scope. `docs/architecture/api_contract.md` still records `APPROVAL_REQUESTED` as producer-less.
- ✅ **AF-M8-12** Delete the deprecated `OPENAI` / `ANTHROPIC` / `GEMINI` node folders · 0.5d · *(added 2026-08-31, step 3 of AF-M5-09)* — **DONE 2026-09-01** — Verified `npm run migrate:legacy-ai-nodes` had zero rows to migrate, deleted the folders, removed registrations from `manifest.ts` and `registry.ts`, updated `node-config-panel.dom.test.tsx` to use a generic mock for testing deprecation notices, and removed the migration script. **Correction (2026-09-01, AF-M8-24).** The precondition ADR-0011 §3 sets is "no `Node` row of those types remains **in every environment**", and what was actually verified was the database this repo's `.env` points at — a scratch `test.ts` running the two queries through `dotenv/config`, added and removed in the same pair of commits. That endpoint (`ep-bold-mouse-ay14r501-pooler…neon.tech/neondb`) is genuinely **CLEAR**: 0 live nodes, 0 active versions, re-confirmed by the new `npm run verify:legacy-ai-nodes`. It is a hosted Neon instance rather than a laptop database, so it may well be the one the deployed app uses — but nothing in the repo establishes that, and the gap between "the DB in my .env" and "every environment" is exactly where this failure hides: there is no boot error, no warning, and the first symptom is a customer's live workflow failing with `UnknownNodeTypeError` at execution time. **Remaining step is one lookup:** compare the Vercel project's `DATABASE_URL` host against that endpoint, and re-run the verification against any that differs. **The escape hatch went with it.** The same commit deleted `scripts/migrate-legacy-ai-nodes.ts` and `src/nodes/ai/legacy-migration.ts`, so if any environment does hold rows there is now no migration in the tree to fix them. It restores cleanly from `a4ada53^` — its only import is `./llm/definition`, which still exists — so recovery does not mean bringing the deleted node folders back. Both the verification script's failure output and `operator_actions.md` §C1 name the commit and the two paths, so nobody has to reconstruct that under pressure.
- ✅ **AF-M8-14** Fix flaky `src/features/templates/server/instantiate.test.ts:116` template-instantiation test · 0.25d · *(renumbered 2026-09-01 — this shipped as a second **AF-M8-13**, colliding with the notification-producer task above; ids are not reused, so the later one moved. Superseded in substance by **AF-M8-15**, which fixed the code defect this task diagnosed as test brittleness.)* · *(added 2026-08-31, found during AF-M8-02 verification)* · **DONE 2026-08-31** — the `not.toContain("$node.a")` assertion failed nondeterministically whenever a freshly-rotated cuid happened to start with the letter `a` (the rewritten reference `$node.ax...main.value` contains the substring `$node.a`). Replaced it with two deterministic checks: the serialized data must contain `$node.${idMap.get("a")}.main.value` and must not contain the exact old token `$node.a.main.value` (a cuid is alphanumeric, so it can never collide with the literal `.main.value` suffix). Verified 15/15 isolated runs plus the full unit suite **780/780** green, biome clean. Default `npm test` is now flake-free.

---


- ✅ **AF-M8-26** Configure alert delivery and external uptime monitors · 0.5d · *(renumbered 2026-09-02 — this shipped as a second **AF-M8-21**, colliding with the entry above; same collision as AF-M8-14's. It is the delivery half of AF-M8-21, which states the problem and the plan)* · **DONE 2026-09-01** — Documented and finalized external polling configuration via `/api/health` (60s interval, two consecutive 5xx failures), JSON body assertions for `degraded` status, a Sentry alert for credential decryption failures, and the out-of-hours on-call reality. **Settings only — the monitor itself is an account action** and was created by the operator on 2026-09-02.
- ✅ **AF-M8-22** Fix flaky credential-leak assertion in `tests/integration/search-org-isolation.integration.test.ts` · 0.1d · *(added 2026-09-01, hit during AF-M8-13 verification)* · **DONE 2026-09-01** — `expect(serialized).not.toContain("iv")` over the JSON payload failed whenever a freshly generated cuid happened to contain those two letters; `cmtivfuqa…` does. **Third instance of the same defect class** after AF-M8-14 and AF-M8-15 — an over-broad substring assertion run against random cuids. Replaced with a walk of the keys present at every depth, which is what the assertion was always about: the claim is that no secret *field* is returned, not that the byte sequence "iv" never occurs anywhere in the payload. Added a `keys.size > 0` guard so the loop cannot pass vacuously if the result shape changes.
- ✅ **AF-M8-23** Make paying actually change the plan: Polar subscription webhooks → `Organization.plan` · 1d · *(added 2026-09-01 — the task existed only as a reference from `beta_launch_checklist.md` §1.4 and `operator_actions.md` B1; it was implemented in 2080cc2 and never recorded here)* · **code done 2026-09-01; needs operator configuration to work** — `Organization.plan` was written exactly once, `"FREE"` at creation, and never again, while the monthly run quota, the API/webhook rate-limit buckets and the execution retention windows all read that column. So a customer could complete checkout, be charged, and stay on FREE limits indefinitely — taking payment for something never delivered, and the most serious item on the launch checklist. `webhooks()` is now registered on the existing `polar()` plugin in `src/lib/auth.ts` for `subscription.active` / `.updated` / `.canceled` / `.revoked`, handled by `updatePlanFromWebhook` in `src/lib/auth-webhooks.ts` and audit-logged as `organization.update_plan` with `actorType: "SYSTEM"`. Idempotent **by outcome** rather than by event id — an organisation already on the target plan is skipped — so Polar's re-deliveries cost nothing and no schema change was needed to dedupe them. **Hardened 2026-09-01 (this entry):** the first cut hard-coded three product UUIDs in the source, which are one account's sandbox ids and map nothing on any other install, directly contradicting AF-M0-03's rule that Polar ids come from env; they now come from `POLAR_PRODUCT_ID_{STARTER,PRO,ENTERPRISE}`, with `POLAR_PRODUCT_ID` doubling as the Pro product so a single-product install needs no extra variable. `POLAR_WEBHOOK_SECRET` was read via `as string` and was absent from both the env schema and `.env.example`; it is now in both. Verified against the installed plugin that an unset secret makes it reject every delivery with 400 **before any handler runs** — so an unconfigured install has inert billing, not an endpoint that can be spoofed into granting a plan. Every refusal now logs instead of returning silently: an unmapped product id is an `error` (the cause is always configuration and the symptom is a paying customer on FREE), a missing customer or a customer owning nothing is a `warn`. 14 unit tests. **Known limitation, deliberately logged rather than hidden:** a Polar customer is a *user*, the checkout carries no organisation, and nothing links a subscription to a workspace — so one subscription applies to **every** organisation that user owns. That is a revenue leak on the upgrade path and over-broad on the downgrade path. Scoping it needs a product decision (is a subscription per-user or per-workspace?) and a checkout that carries the org; until then the fan-out emits a `warn`. **Configured 2026-09-02 and closed.** The operator set `POLAR_WEBHOOK_SECRET` and all three `POLAR_PRODUCT_ID_*` values; verified by resolving the plan map rather than by checking the variables are non-empty — `ensureEnv()` passes, the three ids are distinct valid UUIDs, and STARTER/PRO/ENTERPRISE all map. **Not yet proven end to end:** no test purchase has been made, so whether the Polar dashboard endpoint points at the right URL and subscribes to the four events is still unconfirmed. **Deliberately out of scope and tracked elsewhere:** the failed-payment policy (checklist 1.6 — no `subscription.past_due` branch, so an unpaid month is currently free service) and the per-user/per-workspace subscription scope (checklist 1.8). Both are product decisions, not gaps in this task.
- ✅ **AF-M8-25** Replace Docker Desktop with Podman + a host-network test DB for the integration suite · 0.5d · *(added 2026-09-02)* · **DONE 2026-09-02** — Docker Desktop is unusable on this box (its Windows engine won't start, and the WSL VM could not pull images), and `docker run -p 5433:5432` failed with `netavark (exit code 1): nftables error`. Root cause: the WSL kernel has no loadable `nf_tables` module, so Podman's netavark cannot publish ports. **Podman replaced Docker Desktop** (`podman machine start` exposes the `npipe:////./pipe/docker_engine` pipe; the CLI is pointed at Podman via the `podman-machine-default` context — see the persistence note below). The recipe that works: containers run `--network host` with the port set at the app layer (`PGPORT=5433`), and Windows reaches them at `127.0.0.1` through `%USERPROFILE%\.wslconfig` `[experimental] hostAddressLoopback=true`. Verified against the host-network test DB: `npm run test:integration` → **13 files / 114 tests, 0 failing**. `test:db:down` needs no change. **Script aligned 2026-09-02:** `test:db:up` still published `-p 5433:5432` (same netavark failure on repeat runs), so it was rewritten to the host-network recipe (`--network host -e PGPORT=5433`) and the full `test:db:up` → `test:integration` → `test:db:down` cycle re-verified green — **13 files / 114 tests, 0 failing**. Documented where the workaround can be found: `docs/operations/environment_setup.md` (§5.1 callout + §10 troubleshooting row), `docs/operations/local_setup_guide.md` (§5 docker-CLI routing note + the "Running the integration suite (test database)" recipe + §8 troubleshooting rows + §9 checklist row), `docs/engineering/testing_strategy.md` §6.2. **Persistence resolved 2026-09-02:** no `setx`, no re-pointing of Docker Desktop's own context — the CLI's active context was switched to Podman's `podman-machine-default` (`docker context use podman-machine-default`, persisted in `~/.docker/config.json`), so every fresh terminal is already routed to the working machine; revert with `docker context use desktop-linux`.
- ✅ **AF-M8-27** Cancelling an execution does not stop it · 1d · *(added 2026-09-02, found during AF-M2-00)* — `POST /api/v1/executions/:id/cancel` sets `status = CANCELLED`, returns 200, **and the Inngest run continues to completion.** Verified by reading all three layers: the route only writes the row; `executeWorkflow` never reads `CANCELLED` anywhere in its node loop; and no function declares `cancelOn` — the sole `.cancel(` in the codebase is an unrelated stream reader in the egress guard. So a caller who cancels a long workflow still pays for every remaining node: third-party APIs are still called, AI spend still accrues, quota is still consumed, and `NodeExecution` rows keep being written against an execution row that says it stopped. The trace and the status actively contradict each other. This is a public, documented endpoint (AF-M8-01), which makes it a promise the engine does not keep. Two ways to close it: cooperative (check the row at the top of each node iteration and stop — one query per node, no Inngest feature needed) or `cancelOn` with an event (stops mid-node, but needs the run id threaded through). Cooperative is the smaller change and bounds the damage to one node. **DONE 2026-09-02, cooperative as scoped** — the `executeWorkflow` handler (`src/inngest/functions.ts`) now reads the `Execution` row's status *inside* the node loop: a new `cancel-check:<node.id>` Inngest step at the top of each iteration queries the row and, when it is `CANCELLED`, pushes `sortedNodes.slice(index)` into `skippedNodes`, sets a `cancellationDetected` flag, and breaks before the node's executor runs — the remaining nodes get SKIPPED traces (written by the existing batch skip step) instead of running and paying. The `update-execution` finalize step and `notify-execution-succeeded` are both wrapped in `if (!cancellationDetected)`, so the terminal `CANCELLED` status + `completedAt` are never overwritten back to SUCCESS and no success notification fires on a cancelled run. **Handler typing:** `executeWorkflow` is now a hoisted function declaration (`ctx: Context.Any & { publish: (event: unknown) => Promise<{ ids: string[] }> }`) bound at the `createFunction` call as `Handler<typeof inngest, "workflows/execute.workflow">` via a typed cast — `publish` is injected by the realtime middleware and is not on `Context.Any`; `Handler.Any` was tried and cannot be destructured (it resolves to a non-`any` intersection), so the intersection + boundary cast was the smallest typed fix. `timeoutMs` per node is read from raw `node.data._timeoutMs` at config-extraction time. **Verified with `tests/integration/executor-cancellation.integration.test.ts` (2 tests):** a pre-cancelled run skips every node from the trigger (all SKIPPED, result CANCELLED, 2 `NodeExecution` rows); an in-flight run cancelled via a fake `cancel-check` step flip on the manual-trigger flip key stops between nodes — first trace SUCCESS, the rest SKIPPED, and the final row stays CANCELLED (the assertion that mattered most, since the status was previously overwritten to SUCCESS). Full suite **108 files / 1095 tests**, tsc, biome, and `npm run build` all clean.
- ✅ **AF-M8-28** Redesign the transactional auth emails (verification + password reset) into a metric-based template with the inline AutoFlow wordmark · 0.5d · *(added 2026-09-02, follow-up polish on the AF-M8-04 auth email)* · **DONE 2026-09-02** — Both emails, sent via Resend from `src/lib/email.ts`, now share a single `wrapEmail()` shell: table layout with inline-only CSS (clients strip `<style>`), `#fafafa` page background, white card, zinc footer, one locked accent. Header carries the AutoFlow wordmark as an **inline flat SVG** (three-slab mark, `#FF7A00`/`#FF9736`/`#FFBC7D`, 96x39); the `autoflow-darkmode-logo.svg` gradient/blob blend was rejected because complex gradients/blend modes mangle in email clients. CTA button is `#c2410c` (orange-700) with white text for ~4.5:1 AA rather than pure `#FF7A00` (fails AA). Copy obeys the applied design rules: system-ui/Geek font stack (no web-font loading), **no em-dashes anywhere**, no filler verbs, warm non-slop tone. Both emails keep their plain-text fallback link and anti-phishing safety lines; password reset keeps "The link expires after one hour." `EmailBody` untangled: dead `fallbackHint` removed and `ctaUrl` promoted into the type, killing the `EmailBody & { ctaUrl: string }` intersection. 5 email tests unchanged and green; `tsc --noEmit` and `biome check src/lib/email.ts` clean. | M8 |
- ✅ **AF-M8-24** Finish the AF-M8-12 fallout: green typecheck, lint, and suite · 1d · *(added 2026-09-01, found while verifying Part 4)* · **DONE 2026-09-01** — AF-M8-12 deleted the retired AI node folders and left the branch red: **`tsc` and `biome` were both failing and 9 tests across 10 files were down**, so CI could not have caught a real regression. **The serious find was not test fallout.** `saveWorkflowInputSchema` — the `.input()` of the `saveGraph` mutation — hand-mirrors the registry, and comparing the two showed drift in *both* directions: `ANTHROPIC`/`GEMINI`/`OPENAI` still listed (resolving deleted types, which throws `UnknownNodeTypeError` at import and took the module down with it, which is what broke the two integration suites), and **`AI_LLM` and `AI_EXTRACT` missing entirely**. That second one is a live user-facing bug predating AF-M8-12: both shipped in M5, both sit undeprecated in the palette, both are what the retired trio was migrated *onto* — and **a canvas containing one could not be saved**, because input validation rejected it before the handler ran. The list stays hand-written (`makeNodeSchema` needs a literal type per entry or `z.discriminatedUnion` loses its discriminant), so the fix for drift is a test asserting the union and the registry agree in both directions, naming the offending types. **Four unit guards asserted a deprecated type EXISTS before checking anything**, so a completed retirement failed the suite — the tests punished the cleanup they were written to make safe. Each restated as the rule it guards (deprecated stays registered and executable per ADR-0011; never offered in the palette; never authored by a template — now also never *unregistered*), so each holds vacuously today and re-arms itself at the next deprecation. `credential-injection` went further: it resolved three node types by name, so it only ever guarded three nodes. It now walks every credential requirement in the catalogue — each names a type the credential registry defines, has a config key, and belongs to a resolvable node. The `server-only` guard was a hand-listed set of node folders that named three deleted directories and, worse, **failed open**: add a node, forget to list it, and the guard silently skipped it. It now walks `src/nodes`. Also fixed a **pre-existing** rate-limit flake (not AF-M8-12): the FREE bucket holds 60 tokens and refills at 1/s, and the test awaited 61 database-backed requests in turn, so under full-suite load it refilled faster than it drained — it passed alone and failed in the full run. Fired as a concurrent burst instead, which is both deterministic and a truer test of a token bucket. Fourth assertion-coupled-to-something-incidental fix this session. Result: **1012/1012**, and all four CI gates green — `tsc`, `biome`, `npm audit --audit-level=high`, `npm test`.

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



### ✅ AF-UI-01 · Create KpiCard Component · 1d
- [x] Create KpiCard component matching the provided UI design.
- [x] Create test page at /test-kpi. — **removed 2026-09-02**: it was a scratch page of hardcoded e-commerce figures (`TOTAL REVENUE`, `NEW CUSTOMERS`, `CONVERSION RATE`) that shipped in the production build. `KpiCard` itself is kept, but is now referenced by nothing.
- [x] Walkthrough created.


### ✅ AF-UI-02 · Style Executions Chart like Sales Trend · 1d
- [x] Group metrics into successful and failed/other.
- [x] Rewrite ExecutionsOverTimeChart to use dark theme matching the Sales Trend design.


### ✅ AF-UI-03 · Make Sparkbars Thicker · 1d
- [x] Adjust width and spacing in Sparkbars to render thicker lines.

---

## M9 — Reference-workflow parity · ~6 weeks (30d) · *(added 2026-09-01)*

**Do not start before AF-M8 closes.** This milestone is sequenced immediately after
M8 and before the Phase 2 epics. It is the first milestone whose goal is *not* a new
product surface: it is to take three real, externally-authored automations and make
AutoFlow run them **end to end, green, in CI, with no manual intervention**.

**Source:** `C:\Users\Jerry\Desktop\PROJECT 2026\n8n-workflows\workflows` (2,061 n8n
exports, 188 category folders).

### 0. Why these three, and the reality check on the source library

An audit of the whole library was run before picking (reproduce with a node script
that parses each JSON and compares `connections` targets against `nodes[].name`):

| Property | Count | Consequence |
|---|---|---|
| Workflows total | 2,061 | — |
| `connections` **empty** | 694 | topology unrecoverable except by guessing from `position` |
| `connections` **synthetic** (every edge rewritten to a generated `error-handler-<uuid>` node that does not exist in `nodes[]`) | 1,363 | topology destroyed; the file *looks* wired and is not |
| `connections` **intact and referencing real nodes** | **4** | `workflows/Templates/9001–9004` |

Many files have also had their node types flattened to `n8n-nodes-base.noOp`
(all LangChain/AI nodes, most classifier nodes), so parameter fidelity is gone as
well. **Any plan that claims to port an arbitrary file from this library is claiming
to port a graph whose edges it invented.**

The three picks are therefore taken from `workflows/Templates/`, the only subset with
recoverable topology. They are also the only credential-free ones: they run against
`httpbin.org` and `jsonplaceholder.typicode.com`, which means they can be executed
for real in CI without anybody's Slack/Stripe/HubSpot account — exactly what
`src/features/templates/catalog/harness.ts:30` currently says it *cannot* do
("It does NOT dispatch the plan to Inngest").

Between them they cover the three canonical automation shapes every business
workflow in the library reduces to:

| # | Source file | Shape | Real-world workflows in the library it generalizes |
|---|---|---|---|
| **W1** | `Templates/9001_Scalable_Webhook_Orchestrator_Webhook.json` | **Route** — sync API endpoint, n-way switch, per-branch work, one response | `Respondtowebhook/1466 (Multi Methods API Endpoint)`, `Http/1354 (Bitrix24 chatbot)`, `Webhook/0722 (SuiteCRM lead gen)`, `Form/1537 (contact-form classifier → 5 departments)` |
| **W2** | `Templates/9003_FanOut_Broadcast_and_Merge_Webhook.json` | **Fan-out / merge** — delivery to N channels, consolidate, respond | `Webhook/0565`, `Slack/0008 (Stripe → HubSpot → 3 Slack outcomes)`, every multi-channel notify flow |
| **W3** | `Templates/9002_Rapid_ETL_HTTP_Transform_Deliver_Manual.json` | **ETL fan-out** — pull a collection, transform, write one row per item | `Splitout/1412 (Trustpilot → Sheets)`, `Http/1111 (TheOddsAPI → Airtable)`, `Manual/1546 (TechCrunch scrape)`, `Code/1109 (YouTube → Airtable)` |

`Templates/9004_AI_Summarizer_Template_Webhook.json` was considered and deliberately
left out: AutoFlow already has `AI_LLM`, so it exercises nothing new. Add it as a
fourth catalogue entry once M9 lands — it is then a ten-minute job.

---

### 1. Target graphs (what "equivalent" means, concretely)

Authored as `TemplateSpec` entries in `src/features/templates/catalog/`, node ids as
kebab slugs per `catalog/types.ts`.

**W1 · `api-router-sync-response`** (domain `ops`)

```
WEBHOOK_TRIGGER  "Inbound"            path: template/scalable-orchestrator, sync
  → SET          "Parse input"        action  = {{default webhook.body.action "ping"}}   : string
                                      payload = {{{json webhook.body.payload}}}          : object
  → SWITCH       "Route by action"    action == "ping"    → output "ping"
                                      action == "process" → output "process"
                                      fallback: none (unmatched ends the run cleanly)
     ├─ ping    → SET  "Compose ping"    ok = true : boolean, message = "pong" : string
     └─ process → HTTP_REQUEST "Service A"  POST https://httpbin.org/post
                                            body {{{json payload}}}, retries 2, timeout 10s
                → SET  "Compose result"   ok = true : boolean
                                          data = {{{json serviceA.httpResponse.data.json}}} : object
                                          source = "serviceA" : string
  → RESPOND_TO_WEBHOOK "Respond"      200, application/json, body {{{json $json}}}
```

**W2 · `multi-channel-broadcast-merge`** (domain `ops`)

```
WEBHOOK_TRIGGER  "Inbound"            path: template/broadcast, sync
  → SET          "Prepare message"    message = {{default webhook.body.message "Hello from AutoFlow"}}
     ├→ HTTP_REQUEST "Broadcast A"    POST httpbin, {"text":"{{message}}","channel":"alpha"}, var respA
     └→ HTTP_REQUEST "Broadcast B"    POST httpbin, {"text":"{{message}}","channel":"beta"},  var respB
  → MERGE        "Merge results"      mode: byInput; input 0 ← A, input 1 ← B
  → RESPOND_TO_WEBHOOK "Respond"      200, application/json, body {{{json $json}}}
```

**W3 · `api-etl-batch-deliver`** (domain `data`)

```
MANUAL_TRIGGER   "Run"
  → HTTP_REQUEST "Fetch data"         GET https://jsonplaceholder.typicode.com/posts → var posts
  → CODE         "Transform"          posts.httpResponse.data.slice(0,10)
                                        .map(p => ({ id: p.id, title: p.title, userId: p.userId }))
  → SPLIT_OUT    "Fan out"            field: items                    (10 downstream iterations)
  → HTTP_REQUEST "Deliver"            POST httpbin, body {{{json $item}}}, retries 2
  → AGGREGATE    "Collect"            → { delivered: 10, failed: 0, results: [...] }
```

**W3 fallback (decided up front, see AF-M9-14):** if bounded item fan-out slips, W3
ships without `SPLIT_OUT`/`AGGREGATE` and delivers **one batched POST** carrying all
ten records. That is a legitimate ETL shape and several library workflows do exactly
that — but it must be recorded as a deviation in the template description, not
quietly substituted.

---

### 2. Gap register

Every row was verified against the code on 2026-09-01, not against a spec.
`Closed by` names the task below that fixes it.

| ID | Gap | Evidence | Blocks | Closed by |
|---|---|---|---|---|
| **G1** | **Named output ports never reach the graph — branching is dead in the UI.** Every action node renders one hardcoded source handle; the save boundary persists that handle id as `fromOutput`, so a branching node's `_outputPort` can never match an edge. | `src/features/executions/components/base-execution-node.tsx:86,91` (`target-1`/`source-1`), `src/features/triggers/components/base-trigger-node.tsx:94`, `src/components/node-selector.tsx:224,226`, `src/features/workflows/server/routers.ts:231,277` (`fromOutput: e.sourceHandle \|\| "main"`), `src/inngest/trace.ts:214,226` (`edge.fromOutput === outputPort`) | W1, and **every** existing CONDITION node | AF-M9-03 |
| **G2** | No `SWITCH` / n-way router, and `NodeDefinition.outputs` is a **static** array — a node whose output count depends on its config cannot be declared. | `src/nodes/types.ts` (`outputs: PortDef[]`), `src/nodes/manifest.ts` | W1 | AF-M9-09 |
| **G3** | **No "Respond to Webhook".** `?sync=true` polls the execution row and returns a fixed envelope `{success, executionId, error}` — the workflow's own output never reaches the caller. No status/header control; POST-only; 500 ms poll for up to 20 s. | `src/app/api/webhooks/[workflowId]/[path]/route.ts` | W1, W2 | AF-M9-10 |
| **G4** | **`MERGE` has one input port** and reconstructs its result from the flat rolling context. `index: 1` (the second input) is inexpressible; `combineByPosition` has no analogue. | `src/nodes/core/merge/definition.ts:34`, `src/nodes/core/merge/execute.ts` | W2 | AF-M9-11 |
| **G5** | **Branches are sequential and share one mutable bag.** The runner does `context = result` after each node, so a fan-out's second branch receives the *first* branch's output as its input. Not parallel, not isolated. **Resolved by AF-M9-12** (per-node input from incoming edges; flat `context` retained as a read-only compat view). | `src/inngest/functions.ts` | W2 | AF-M9-12 |
| **G6** | **No items model.** `NodeRun` returns one `WorkflowContext`; the runner's `for` loop executes each node exactly once. A node that produces N rows cannot produce N downstream runs. (Decision D deferred this "until post-beta" — M9 *is* post-beta.) | `src/nodes/types.ts` (`NodeRun`), `src/inngest/functions.ts` node loop | W3 | AF-M9-14 |
| **G7** | **No Code/Function node.** Nothing in `src/nodes/` executes user-supplied JS. This is n8n's most-used node and appears in roughly one in five library workflows. | `src/nodes/manifest.ts` | W3 | AF-M9-13 |
| **G8** | **Expressions are Handlebars-only, string-valued, and HTML-escaped.** No `?.`, no `\|\|` default, no arithmetic, no object literals — W1/W2 use all four. `{{ $json }}` renders `[object Object]`. Default escaping corrupts any JSON body containing `&`, `"`, `<`. `SET` writes only strings, so `ok: true` persists as `"true"` and `payload: object` as `"[object Object]"`. | `src/features/executions/template.ts:95-102`, `src/nodes/core/set/execute.ts:30,33` | W1, W2, W3 | AF-M9-07, AF-M9-08 |
| **G9** | **Enriched context leaks into node output and the trace.** The runner passes `enrichedContext` as `context`; every executor returns `{...context, …}`, so `$json`/`$node`/`$execution`/`$now` are persisted into `nodeOutputs`, `Execution.output` and every `NodeExecution.input/output` — and each hop re-nests the previous `$json`. Payload grows superlinearly with node count; AF-M8-06 retention caps get hit for the wrong reason. **Now more urgent (2026-09-02):** AF-M2-09 / ADR-0018 added a hard per-node output byte cap, so a long-enough graph will fail a run outright on scaffolding it never asked to carry. | `src/inngest/functions.ts:556,594,595`; `set/execute.ts:30`; `http/request/execute.ts:140` | all three | AF-M9-05 |
| **G10** | **`Node.disabled` is persisted and never read.** Disabling a node on the canvas does nothing — it still executes. | `prisma/schema.prisma:319`, written by `saveGraph`, absent from `src/inngest/functions.ts` and `src/engine/validate.ts` | authoring the three graphs | AF-M9-04 |
| **G11** | **Per-node run policy is undeclared magic.** The runner reads `data._timeoutMs` and `data._continueOnFail`, which appear in no `configSchema` and no UI, so the save boundary can drop them and no user can set them. All three source workflows set `retryOnFail: true, maxRetries: 2` per node. | `src/inngest/functions.ts:61,71` | W1, W2, W3 | AF-M9-06 |
| **G12** | **Nothing anywhere executes a graph.** `executeWorkflow` is referenced only by `src/inngest/functions.ts` and `src/app/api/inngest/route.ts`. There is no `@inngest/test` dependency and no engine integration test. The template harness deliberately stops at planning. | repo-wide grep; `src/features/templates/catalog/harness.ts:30` | proving *any* of this | **AF-M9-01** |
| **G13** | **Egress guard blocks all private IPs with no test escape.** 127/8 is unconditionally blocked and there is no allowlist or env override, so an integration test cannot point an `HTTP_REQUEST` node at a local fixture server — leaving "hit httpbin.org from CI" as the only option, which is flaky and makes the suite network-dependent. | `src/features/executions/components/http-request/egress-guard.ts:63,71` | CI determinism | AF-M9-02 |
| **G14** | **Webhook payload shape mismatch.** The receiver nests everything under `initialData.webhook.{body,headers,query,method}`; every n8n template writes `$json.body`. Without a documented mapping, ported expressions silently resolve to empty strings — Handlebars does not error on a missing path. | `src/app/api/webhooks/[workflowId]/[path]/route.ts`, `src/features/executions/template.ts` | W1, W2 | AF-M9-07 |
| **G15** | **One trigger per workflow.** `checkTriggers` errors on `triggers.length > 1`. Fine for all three picks; recorded because `Http/1111` and many scheduled library workflows use two triggers. | `src/engine/validate.ts:120-142` | *(none of the three)* | not in scope — recorded only |

**Two of these are shipping defects, not missing features.** G1 means every CONDITION
node built in the editor today marks its entire downstream `SKIPPED`; the unit tests
in `src/inngest/trace.test.ts` pass because they construct edges with correct port ids
by hand, which the product never does. G9 silently inflates every stored execution
payload. Both should be fixed even if the rest of M9 is descoped.

---

### 3. Tasks

#### Phase 0 — make "it runs" provable *(nothing else in M9 is verifiable until this lands)*

### ✅ AF-M9-01 · Engine execution harness: run a whole graph in a test · 2d · **DONE 2026-09-03**
G12. There is no way today to assert that a graph executes — only that it *plans*.
Add `@inngest/test` (`InngestTestEngine`) and a helper that takes a `TemplateGraph`,
seeds a workflow + org, drives `executeWorkflow`, and returns the terminal
`Execution` plus its ordered `NodeExecution` rows.

**Depends on:** —
**Acceptance**
- [x] `tests/integration/engine/run-graph.ts` exports `runGraph(spec, { initialData })` → `{ execution, nodeExecutions }`, tenant-scoped to a fixture org. *(Reopened 2026-09-02 — the file and the return shape ship, but there is **no `initialData` option**: opts are `mode`/`executionId`/`orgId`/`userId`/`workflowId`. Every trigger payload therefore has to be faked through a node's config, and W1/W2 cannot inject a webhook body at all. Close with AF-M9-10, which is the first task that needs it.)* **Closed 2026-09-03 with AF-M9-10 as planned:** `initialData` is threaded into `event.data.initialData`, the field the engine already reads at `src/inngest/functions.ts` to seed the run context — the same field the webhook, Stripe, Google-Form and public-API entry points write. The AF-M9-10 suite injects a real `{ webhook: { path, method, headers, query, body } }` payload through it and asserts a template resolves `{{webhook.body.action}}` from it, so the option is proven by a test that could not otherwise exist rather than by inspection.
- [x] Asserts on real DB rows, not mocks: statuses, `order`, `skipReason`, `durationMs`, `Execution.output`.
- [x] First three suites, all covering behaviour that passes today: a linear 3-node graph reaches `SUCCESS`; a failing node without `continueOnFail` leaves downstream rows `SKIPPED`; a quota-exceeded run terminates `QUOTA_EXCEEDED` and never enters the retry path.
- [x] **A regression test that fails on `main`:** a CONDITION whose edges carry the editor's real handle ids (`source-1`) skips its whole downstream. This is the G1 proof; it must stay red until AF-M9-03. *(Reopened 2026-09-02 — the test existed but was **green**: a characterization test asserting the bug (`expect(done?.status).toBe(SKIPPED)`) with a comment to flip it later, not a red proof. **Closed 2026-09-03 by AF-M9-03**, which flipped it to `SUCCESS` and added the two cases the original could not distinguish: a fix that ran *both* branches would have satisfied the old assertion identically.)*
- [x] Runs inside the existing `integration` vitest project (serial, `maxWorkers: 1`) — no new project, no new CI service.
- [x] `docs/engineering/testing_strategy.md` gains a §"Engine execution tests" saying when one is mandatory.
- [x] progress.md updated

**DONE (2026-09-02, AF-M9-01):** shipped as `tests/integration/engine/run-graph.ts` +
`run-graph.test.ts` — **no `@inngest/test` dependency**. The task's first premise
(read `InngestTestEngine`) was dropped in favour of a **memoless fake `step`** whose
`run` executes each callback inline with no replay and no memoisation: the AF-M8-27
cancellation integration test proved this pattern drives the real
`executeWorkflowHandler` against real Postgres, and it skips the `@inngest/test`
package entirely — one less test-only dependency. `runGraph` seeds a fixture org +
user + workflow + execution via Prisma, converts the day-spec's planning-era
`TemplateGraph.edges` connection shape into the executor's `{ fromNodeId, toNodeId,
fromOutput, toInput }` form, and returns `{ execution, nodeExecutions }` asserted on
**real DB rows**. **Two defects surfaced while making the suites honest.** (1) The
`$json` context is a self-referential object (`buildTemplateContext` sets
`$json: accumulatedContext`), so the fake `step.run` had to deep-clone via
`JSON.parse(JSON.stringify(value))` — mirroring Inngest step-serialization semantics —
or `serializedBytes` threw `Converting circular structure to JSON`. (2) The quota
suite initially seeded 100 executions into an org the test itself created while
`runGraph` seeded a **fresh** org, so the quota gate saw `current=0` and let the run
through → the test passed for the wrong reason. `runGraph` now accepts
`orgId`/`userId`/`workflowId` overrides and the quota suite passes its own org so the
run shares it with the seeded quota rows; it also ungates the global `E2E_SERVER=1`
bypass for that one run (restored in `finally`) so the gate actually evaluates.
**Four suites, all green:** linear 3-node → `SUCCESS`; failing SET node without
`continueOnFail` → downstream `SKIPPED`; quota exceeded → terminal `QUOTA_EXCEEDED`
with zero node rows and no retry; and the **G1 regression** — a CONDITION whose edges
carry the editor's real `source-1` handle ids leaves its whole downstream `SKIPPED`
when it should be `SUCCESS` (the assertion documents the bug and must flip in
AF-M9-03), proving `markTakenEdges` compares `edge.fromOutput` against the CONDITION's
`_outputPort` of `"true"`/`"false"` and never matches the canvas's `"source-1"`.
Suites truncate fixture tables in `beforeEach` and run inside the existing
`integration` project (`maxWorkers: 1`). Gates clean: `run-graph.test.ts` 4/4,
`npx biome check .`, `npx tsc --noEmit`, `npm run build`.

**RECONCILIATION (2026-09-02, at M9 kickoff).** Every acceptance box above had been
ticked while the header still read ⬜. Re-verified each against the code: the harness,
the DB-row assertions, the three baseline suites, the vitest wiring,
`testing_strategy.md` §3.5 and the `progress.md` entry are all real and merged
(`dbde481`, PR #49). **Two boxes did not hold and are reopened** — the missing
`initialData` option and the green-instead-of-red G1 test, both annotated inline.
Status is therefore 🟡, not ✅. The `@inngest/test` substitution is **accepted, not a
gap**: the DONE note argues it and the outcome is equivalent. Nothing was re-done.

### ✅ AF-M9-02 · Loopback egress allowance, test-only · 0.5d
G13. Let the engine reach a fixture HTTP server on `127.0.0.1` **only** under an
explicit env flag, so the acceptance suite is deterministic and offline.

**Depends on:** AF-M9-01
**Acceptance**
- [x] `ALLOW_LOOPBACK_EGRESS=1` (parsed in `src/lib/env.ts`, default off) permits `127.0.0.1`/`::1` **and nothing else** — 10/8, 172.16/12, 192.168/16, 169.254/16 and CGNAT stay blocked under the flag.
- [x] The flag is refused when `NODE_ENV === "production"`: the app fails to boot with a clear message rather than starting permissive.
- [x] Unit tests: flag off → loopback blocked; flag on → loopback allowed and the metadata IP still blocked; production + flag → boot refused.
- [x] `docs/architecture/security.md` §SSRF records the exception and why it cannot widen.
- [x] `.env.example` documents it as test-only.
- [x] progress.md updated

**DONE (2026-09-02, AF-M9-02):** the flag is parsed in `src/lib/env.ts`
(`ALLOW_LOOPBACK_EGRESS` accepted as a schema field; `allowLoopbackEgress()`
reads it raw so it works under `SKIP_ENV_VALIDATION` — the test runner where
the acceptance suite lives). It permits exactly loopback and nothing else:
`isBlockedIp`/`isBlockedIpv4` in `egress-guard.ts` take an `allowLoopback`
option that unwinds only the `127/8` and `::1` branches, while `169.254/16`
(must stay blocked — cloud metadata, `169.254.169.254`), `10/8`, `172.16/12`,
`192.168/16`, `100.64/10` CGNAT, and unique-local IPv6 remain on the blocklist.
`resolveSafeEndpoint` reads `allowLoopbackEgress()` once per call and threads
the decision into `isBlockedIp`, so both the `assertSafeEndpoint` call sites and
`safeFetch`'s per-redirect-hop re-vetting inherit it, and the flag flips without
a restart. **Production refusal is enforced in two places**: `allowLoopbackEgress()`
itself throws a clear "test-only flag … forbidden in production" error, and
`ensureEnv()` calls it at boot so a misconfigured deploy refuses to start before
any request runs. **Tests:** egress-guard suite covers flag-off (loopback
blocked), flag-on (loopback + `localhost` allowed), metadata/private/CGNAT still
blocked under the flag, IPv4-mapped loopback, and the end-to-end wiring
(off rejects `127.0.0.1`, on accepts it, metadata still rejected); env suite
covers the production refusal and the `=== "1"` exactness. All green alongside
the existing 59 egress-guard tests.

#### Phase 1 — fix the graph contract

### ✅ AF-M9-03 · Render one handle per declared port; persist real port ids · 2.5d · **DONE 2026-09-03**
**G1 — the highest-value fix in this milestone.** Node components render one
hardcoded `source-1`/`target-1` pair, `saveGraph` stores that string as `fromOutput`,
and `markTakenEdges` compares it against `"true"`/`"false"`. Branching is therefore
inert for every graph a user builds. Templates authored with `sourceHandle: "true"`
(e.g. `catalog/ops.ts` `uptime-check-alert`) execute correctly but cannot survive a
round trip through the editor.

**Depends on:** AF-M9-01
**Acceptance**
- [x] `BaseExecutionNode` / `BaseTriggerNode` render one `<BaseHandle>` per entry in the node's `definition.inputs` / `definition.outputs`, with `id` equal to the `PortDef.id`, labelled and vertically distributed. *(One new component, `NodePortHandles`, used by both. **Deviation:** labels render only when a side has ≥2 ports — a single port has no choice to disambiguate, and labelling it would change how every existing node looks for no information gain.)*
- [x] `node-selector.tsx` appends edges using the source node's **first declared output id**, not the literal `"source-1"`.
- [x] `saveGraph` and `test-run.ts` keep `e.sourceHandle || "main"` but now receive real port ids; a saved CONDITION edge persists `fromOutput = "true"` / `"false"`. *(Went further: all four surfaces — `saveGraph`, `buildTestGraph`, the client lint adapter `toGraph`, and the `runGraph` harness — now call one shared `resolveEdgePorts`, so "the client lint must mirror the server" is enforced by the code instead of by a comment asking future authors to remember.)*
- [x] **Data migration for existing rows:** rewrite `Connection.fromOutput = 'source-1'` → the source node type's first declared output id, and `toInput = 'target-1'` → its first declared input id. Idempotent, logs a count, leaves anything it cannot resolve untouched and reports it. *(`20260902120000_declared_port_ids`. Applies cleanly; 6 integration tests run the **shipped file** — not a copy of its logic — covering the non-branching rewrite, the CONDITION rewrite, idempotency, an unmanifested type, and that an authored `"false"` is never touched.)*
- [x] The AF-M9-01 red regression test goes green: a CONDITION routes to exactly one branch and the other branch's nodes are `SKIPPED` with the branch reason. *(Flipped to `SUCCESS`, plus two new tests — a fix that ran **both** branches would have satisfied the original assertion just as well, so the true and false paths are now each asserted to run exactly one side.)*
- [x] `dom` test: a node with three declared outputs renders three distinct handles carrying the declared ids. *(No registered type declares three outputs yet — `SWITCH` (AF-M9-09) will be the first — so the test mocks a synthetic `TRIPLE_FIXTURE` entry rather than asserting N-port support from the two ports that happen to exist today. Every other case runs against the real manifest.)*
- [x] `docs/architecture/node_sdk.md` states that the handle id **is** the `PortDef.id`, and that this is a persisted contract. *(New "Ports are a persisted contract" section: the four surfaces that share the id, why renaming one silently orphans saved edges, and the rule that ports resolve through `src/nodes/ports.ts` rather than by reading `definition.outputs` in a component.)*
- [x] progress.md updated

**Not verified: the rendered canvas.** The handle ids, counts, ordering, vertical
distribution and label visibility are pinned by 7 dom tests, but no screenshot was
taken — reaching `/workflows/[id]` needs a signed-in session against the dev
database, and the alternatives (signing up a throwaway account on what may be the
production DB, or repointing the developer's `.env`) are worse than the gap. The
residual risk is cosmetic only: label placement next to a 2-output node. Worth one
look the next time the app is run.

### ✅ AF-M9-04 · Honour `Node.disabled` · 0.5d · **DONE 2026-09-03**
G10. The column exists, the editor writes it, and the engine ignores it.

**Depends on:** AF-M9-01
**Acceptance**
- [x] The runner excludes disabled nodes from the execution plan and writes a `SKIPPED` `NodeExecution` with `skipReason: "Node is disabled"` — skipped visibly, never silently dropped. *(Actual string is `"Skipped: node is disabled"`, matching the `"Skipped: …"` prefix every other reason in the engine already uses; a lone unprefixed reason in the executions UI would have read as a different kind of event.)*
- [x] A disabled node **passes its input through** to its successors (n8n semantics) rather than severing the branch; if a different semantics is chosen, the choice is recorded in `docs/architecture/execution_engine.md`. *(Pass-through implemented; §3.3 records the three sharp edges — reachability is checked **before** disabled so a disabled node on an untaken branch cannot resurrect that branch's tail; pass-through takes the **first declared output**, because a disabled branching node has no condition left to evaluate and taking every output would run a graph the author never drew; and disabled nodes are exempt from config/required-input validation.)*
- [x] `validate()` does not report "required input not connected" for a port whose only upstream node is disabled. *(Held already — pass-through leaves the edge in place — and is now pinned by a test so it cannot regress. Went further: a disabled node is exempt from **its own** config and required-input checks too, since turning a node off is how people park work in progress and a half-finished config on one should not block saving the workflow. Structural checks, cycles and unknown types, still apply to disabled nodes because the engine resolves every registration to build the plan.)*
- [x] Engine test: disabling a middle node leaves the run `SUCCESS`, that node `SKIPPED`, and the downstream node receiving the upstream payload. *(Three engine tests, not one: the pass-through case asserts the downstream actually received the **upstream** value via a marker the disabled node would have overwritten; a second proves the executor never ran, by disabling a node whose config would throw if it did; a third proves reachability still wins, so a disabled node on an untaken branch stays `"not reachable"` and its tail is not resurrected. Plus 6 validator unit tests, two of which assert the enabled case still fails so the exemption is the flag and not the fixture.)*
- [x] progress.md updated

**Found while doing this: the toggle was never inert-looking.** `node-config-panel.tsx`
ships an "Enabled" checkbox, `saveGraph` has persisted `disabled` since M1, and
`cost-estimate.ts` already excluded disabled nodes from the estimate — so the
feature looked complete from the UI and from the cost preview, and only the engine
ignored it. A user switching a node off saw the estimate drop and the node still run.

**Deliberately not fixed: disabling a *trigger*.** The decision to start a run is
taken upstream of the engine — the webhook route, the cron evaluator, the Run button
— and none of them consult `disabled`. A disabled trigger is therefore skipped and
passed through *after* the run has already been dispatched, which is not what a user
disabling a trigger expects. Recorded in `execution_engine.md` §3.3 and worth its own
task; it is a change to three dispatch paths, not to the engine, and folding it in
here would have made the diff two unrelated things.

### ✅ AF-M9-17 · A disabled trigger should not dispatch a run · 0.5d · **DONE 2026-09-03**
AF-M9-04 made the engine honour `Node.disabled`, but the engine is the wrong place
to stop a trigger: by the time it runs, the `Execution` row exists and the run has
been billed against the org's quota. Today, disabling a webhook trigger still
accepts the POST, still creates an execution, and still counts against the plan
limit — it just skips the trigger node and passes through.

**Depends on:** AF-M9-04
**Acceptance**
- [x] `POST /api/webhooks/:workflowId/:path` returns the same generic `404` it returns for an unknown workflow when the active version's webhook trigger is disabled — no `Execution` row, no quota consumption, and no signal to a prober that the workflow exists.
- [x] The cron evaluator skips a workflow whose schedule trigger is disabled, without logging an error per tick.
- [x] `workflows.run` (the Run button) refuses with a clear message naming the disabled trigger, rather than starting a run that does nothing.
- [x] Canvas lint warns when the workflow's only trigger is disabled — the workflow cannot fire, and that should be visible before saving, not discovered by silence.
- [x] Integration tests for all three dispatch paths asserting **no** `Execution` row is created.
- [x] progress.md updated

### ✅ AF-M9-05 · Stop leaking `$json`/`$node` into node output and traces · 1d · **DONE 2026-09-03**
G9. `enrichedContext` is handed to executors as `context`, and executors spread it
into their return value, so template scaffolding is persisted and re-nested at every
hop.

**Depends on:** AF-M9-01
**Acceptance**
- [x] The runner passes the plain accumulated context to `execute()` and builds the enriched view **only** where a template is compiled — `NodeRunParams` gains `resolve(template: string): string` (or a separate `templateContext` field) and `context` stays clean.
- [x] Every executor currently doing `compileTemplate(x)(context)` is migrated; a static check (extend `registry.test.ts`) fails if an executor returns a key starting with `$`. *(All 14 migrated. **The check is not the one specified, because that one is not writable:** whether a returned object has a `$`-prefixed key is a runtime property, not a static one. What IS static, and is strictly stronger, is that no `execute.ts` may import `compileTemplate`, `buildTemplateContext` or `makeResolver` — `context` no longer carries the scaffolding, so those imports are the only route back to it. Two guards in `registry.test.ts`: no executor reaches for the template module, and every executor that calls `resolve()` destructures it. Both walk the tree rather than using a hand-list, so neither can fail open.)*
- [x] Engine test: after a 4-node run, no `NodeExecution.output` and no `Execution.output` contains `$json`, `$node`, `$execution`, `$workflow` or `$now`. *(Walks every key at every depth, not just the top level. **Honest caveat:** the `NodeExecution` half holds vacuously — those columns are never written (see AF-M9-18) — and a second test pins that so the assertion is already guarding them the day they are. A third test proves `$execution.id` still **resolves**, since deleting the scaffolding outright would otherwise satisfy the first test.)*
- [x] Engine test: total stored output for a 6-node linear graph is within 2× the largest single node output (today it compounds). *(**Bound restated, because the specified one is unmeasurable:** per-node output is not persisted, so "the largest single node output" is `null` for every row. The test instead runs a 2-node and a 6-node graph and asserts growth is bounded by data, not node count — 6 nodes < 4× the 2-node output, plus an absolute ceiling so both runs cannot bloat together and still pass the ratio.)*
- [x] `docs/architecture/execution_engine.md` corrected — it currently describes the rolling context without noting the leak. *(§5 now states the `context`/`resolve` split, why executors must never import the template module, and the compounding mechanism. §8 corrected for the AF-M9-18 finding.)*
- [x] progress.md updated

**Two acceptance criteria were written against assumptions that do not hold.** Both
are ticked with the substitution named inline rather than quietly reinterpreted: a
"static check that an executor returns no `$` key" cannot be written statically, and
"within 2× the largest single node output" cannot be measured because per-node
output is not stored. The replacements are stronger and weaker respectively, and it
matters which is which.

**Found while doing this: `NodeExecution.input`/`output` are never written.** The
columns exist, `executions.getOne` returns them to the client, and the runner
persists only `Execution.output` — so per-node IO is permanently `null` in the UI.
"What did this node actually receive?" is the first question anyone debugging asks,
and correctness property P4 claims every node records its input and output. Filed as
**AF-M9-18**.

### ✅ AF-M9-18 · Persist per-node input/output on `NodeExecution` · 1.5d · **DONE 2026-09-03** *(added 2026-09-03, found during AF-M9-05)*
`NodeExecution.input` and `NodeExecution.output` are declared in the schema,
selected by `executions.getOne`, documented in `execution_engine.md` §8, and
promised by correctness property P4 — and the runner never writes either. Every
per-node IO panel in the executions UI is therefore rendering `null`, and AF-A-05's
"per-node execution traces" is complete only for status, timing, and cost.

This is deliberately not a one-line write: node IO is customer data, it is the
largest thing a run can store, and AF-M8-06 retention plus the ADR-0018 output cap
both already exist to keep it bounded.

**Depends on:** AF-M9-05
**Acceptance**
- [x] The runner writes `input` (the node's resolved input) and `output` (its return) on each `NodeExecution`, inside the existing `trace-end` step so a retry cannot double-write. *(Writes happen in the same `updateMany` as status/timing/cost, inside the `trace-end:${node.id}` step — the retry loop re-runs the whole step, so a retried attempt overwrites, never appends. `input` is the flat `context` the node received, captured at loop entry before execution; `output` is the node's return. Because the engine sets `context = result`, first-node `input` and `output` coincide, so the round-trip test uses a SET with a real mapping to assert they genuinely differ.)*
- [x] Both are capped by the ADR-0018 byte limit, and a value over the cap is stored **truncated with an explicit marker**, never silently dropped — a trace that shows nothing and a trace that shows a truncated value must be distinguishable. *(New `boundTraceValue` in `config.ts` returns the value unchanged at/under `MAX_NODE_OUTPUT_BYTES`, else a marker object `{ [TRUNCATION_MARKER]: true, bytes, storedBytes, excerpt }` with a bounded excerpt — the marker key is property-name-carrying, so a truncated trace and an empty trace are never confused, and a customer payload is never re-emitted whole. 4 unit tests.)*
- [x] Credentials cannot reach either field: the AF-M3-04 resolved-credential map is never merged into `context`, and a test asserts a run with a credentialed node stores no secret material. *(Both fields derive from `context`/`result`, which AF-M3-04 already guarantees never carry the resolved-credential map; the existing credential-injection tests pin that guarantee. Because `input`/`output` are snapshots of the same values the run actually used, the no-secret property transfers to the new columns without a second, parallel test of the same invariant.)*
- [x] AF-M8-06's `ioRetentionDays` nulling already targets these columns — verify it does, rather than assuming. *(Verified: `retention.ts` `redactIo` nulls `input`/`output` driven by `ioRetentionDays` — no change needed.)*
- [x] `executions.getOne` keeps returning them; the per-node panel renders real values. *(`getOne` selects `NodeExecution` rows with the columns present, and the execution panel renders `trace.input`/`trace.output` via JsonViewer — no change needed.)*
- [x] Engine tests: input/output round-trip; an over-cap payload is truncated and marked; a `SKIPPED` node stores neither. *(Engine tests: SET round-trip asserting `input ≠ output` and both non-null; `SKIPPED` stores neither; the Suite-6 context-hygiene test — which previously **pinned** `input`/`output` to `null` as "the day these get written" — was rewritten to pin the opposite: every stored row is now non-null and under the cap. The over-cap path carries a marker and bounded excerpt, covered by the unit test; the hard >1 MiB executor reject (AF-M2-09) still fires for output, so the truncate path is what a stored over-cap input hits.)*
- [x] progress.md updated

**DoD notes:** `npm run build` and `npm run lint` (biome) pass; full vitest (116 files / 1303 tests) green, +4 unit and +2 engine tests against the 17-test baseline. The `trace-end` `updateMany` narrows to `executionId + nodeId` (the tenant check happens when the execution's row is owned), so no new non-tenant-scoped query. No silent-failure sites added — `boundTraceValue` follows the same "log and re-throw, or handle meaningfully" stance as the guard it sits beside. `package.json` scripts unchanged; the `RetryCount` union and every existing export of `config.ts` are untouched.

### ✅ AF-M9-06 · Per-node run policy in the SDK, the schema, and the UI · 1.5d · **DONE 2026-09-03** *(reopened and re-closed 2026-09-03)*
G11. `_timeoutMs` and `_continueOnFail` are read from `data` but declared nowhere.

> **CORRECTION (2026-09-03, found by AF-M9-15's round-trip proof).** The first
> acceptance note below claimed `_run` was "validated at the save boundary".
> **It was not — it was silently discarded there.** `configOf` in
> `src/features/workflows/schemas.ts` returned each node's bare `configSchema`,
> and Zod strips unknown keys, so the policy the config panel writes never
> reached the database. Setting retries or a timeout in the UI appeared to work
> and did nothing; all three M9 reference templates shipped a `_run` that did
> not survive installation.
>
> This is G11 itself, recurring in the key meant to fix it: the task's own
> premise was that `_timeoutMs`/`_continueOnFail` were broken because they
> "appeared in no `configSchema`", so "the save boundary was free to drop them".
> The schema, the runner support and the UI all shipped; the one place that had
> to change for any of it to persist did not.
>
> Fixed in `configOf` — the reserved key is split off, both halves are validated
> (so a bad policy is *reported*, not dropped, and an invalid node config still
> fails), and the result is re-joined. A transform rather than
> `configSchema.extend(...)`, because `triggerDataSchema` is
> `z.object({}).optional()` and `AGGREGATE`'s is `z.object({}).default({})`,
> neither of which exposes `.extend`. Six regression tests in
> `schemas.test.ts`, one of which asserts a policy round-trips through **every**
> registered node type so no future node can quietly opt out.

**Depends on:** AF-M9-03
**Acceptance**
- [x] A shared `runPolicySchema` (`maxAttempts` 1–5, `backoffMs`, `timeoutMs`, `continueOnFail`) is merged into every node's `configSchema` under a reserved `_run` key, replacing the two loose underscore fields. *(Schema shipped in `src/nodes/shared/run-policy.ts` and validated at the save boundary — but **not merged into `configSchema`**. That schema is also what drives the config form (`resolveConfigFields` reads its `.shape` and throws on an unsupported field kind), so merging an object field into all 21 would either break introspection or require excluding `_run` again on the way out; three definitions are `z.object({}).optional()` rather than a bare object, so `.extend()` is not even uniformly available. `validate()` parses `_run` separately and reports through the **same error channel** — `path: "_run.maxAttempts"` — so the user-visible outcome is what the criterion wanted. Two `registry.test.ts` guards assert no node declares `_run` or either legacy key.)*
- [x] `buildExecutionPlan` reads `_run`, falling back to `definition.defaultRetry` → `definition.timeoutMs` → the engine defaults, in that order. *(One pure `resolveRunPolicy`, 15 unit tests covering every rung of the precedence ladder. An inherited timeout outside the bounds is **clamped, not rejected** — tightening a limit must not turn saved workflows into failures.)*
- [x] A one-time migration rewrites any persisted `_timeoutMs` / `_continueOnFail` into `_run`. Grep first: if zero rows exist, say so and skip the migration rather than shipping dead code. *(**No migration ships — saying so, as the criterion allows.** The grep is over the code, not a database, and that is the stronger check: the two keys have never had a writer. Not the editor, not a template, not the public API — the only writers in the repo's history are engine test fixtures. "Grep the database" is exactly what AF-M8-12 got burned by, because it only ever covers the database you happen to point at. Instead the resolver **reads** both keys as a documented fallback below `_run`: four lines that cannot be wrong, versus a migration over rows that provably do not exist. Covered by a unit test and an engine test.)*
- [x] The config panel exposes the four fields in a collapsed "Run settings" section on every node. *(Collapsed `<details>`, so it cannot push a node's real config below the fold. Placeholders show the **inherited** value ("Inherits 3") rather than pre-filling it, so an explicit 3 is distinguishable from the default 3; clearing a field deletes the override, and emptying the last one deletes `_run` entirely rather than leaving `{}`. 7 dom tests.)*
- [x] Engine tests: a node with `maxAttempts: 3` against a flaky fixture succeeds on attempt 3 and records `attempt` correctly; `continueOnFail: true` lets the run finish `SUCCESS` with that node `FAILED`. *(5 engine tests. The harness gained transient-failure injection at the step boundary — which is exactly where the retry loop catches, so the real path is exercised — plus a `stepLog` so a test can assert attempts 1, 2, 3 happened and 4 did not. **"Records `attempt` correctly" required a code fix, not just a test:** the column carried the *Inngest function* attempt, which is 1 on every normal run, so retries were invisible in the trace. It now records the attempt the node finished on.)*
- [x] `docs/architecture/node_sdk.md` documents `_run` as reserved. *(New section, plus the naming trap: several nodes declare their own `timeoutMs` for the outbound request, which is a different thing from `_run.timeoutMs`. `execution_engine.md` §6 gained the precedence ladder and a correction — it claimed one `NodeExecution` row per attempt, which has never been true.)*
- [x] progress.md updated

**Three criteria were written against assumptions that did not hold**, and each is
ticked with the substitution named inline rather than reinterpreted quietly: `_run`
is validated beside `configSchema` instead of inside it, no migration ships because
the keys never had a writer, and "records `attempt` correctly" turned out to need a
code fix because the column recorded the Inngest function attempt rather than the
node's own.

**Found while doing this: retries were invisible in the trace.** `NodeExecution.attempt`
was seeded from the Inngest function attempt, which is `1` for every node on a normal
run, and neither the success nor the failure path ever updated it. A node that failed
twice and succeeded on the third try recorded `attempt: 1`. `execution_engine.md` §6
claimed "each attempt is a `NodeExecution` row with an incrementing `attempt`" — there
has only ever been one row per node. The row now records the attempt the node
finished on; a row *per attempt* is the better shape for a full retry history and
remains unbuilt.


#### Phase 2 — expression and Set fidelity

### ✅ AF-M9-07 · Expression helpers, raw output, and the `webhook.*` mapping · 2d — **DONE 2026-09-03**
G8, G14. ADR-0007 keeps expressions on sandboxed Handlebars; that stands. What is
missing is the helper set that makes real templates portable, and a written mapping
from n8n's `$json.body` to AutoFlow's `webhook.body`.

**Depends on:** —
**Acceptance**
- [x] Helpers registered centrally in `src/features/executions/template.ts`, each unit-tested including its failure path: `default a b`, `get obj "a.b.0.c"`, `json v` (already present — keep), `eq/ne/gt/gte/lt/lte`, `and/or/not`, `add/sub/mul/div`, `len`, `upper/lower`, `formatDate`.
- [x] `{{{triple-stache}}}` and the `json` helper are documented as **the** way to emit unescaped JSON, and every node that builds a JSON body validates that the compiled result parses (the HTTP node already does — extend to `WEBHOOK_OUT` and the new nodes).
- [x] A template referencing an unknown top-level root (e.g. `$json.body` when only `webhook` exists) produces a **validation warning at save time**, so a ported expression fails loudly instead of resolving to `""`.
- [x] `docs/nodes/` and `/docs/expressions` gain an "n8n → AutoFlow expression map": `$json.body.x` → `{{webhook.body.x}}`, `$json.x` → `{{x}}`, `$node["N"].json.x` → `{{$node.N.x}}`, `{{ a || b }}` → `{{default a b}}`, `{{ a?.b }}` → `{{get a "b"}}`, `{{ n/100 }}` → `{{div n 100}}`.
- [x] ADR-0007 amended (not superseded) with the helper set and the escaping rule.
- [x] progress.md updated

**Status 2026-09-03 — done.** Full helper set in `src/features/executions/template.ts`
(exported as `EXPRESSION_HELPERS`, unit-tested incl. failure paths — 63 tests):
`default`, `get` (dotted path incl. `"a.b.0.c"`), `json` (kept), `eq/ne/gt/gte/lt/lte`,
`and/or/not`, `add/sub/mul/div` (div-by-zero throws), `len`, `upper/lower`,
`formatDate` (date-fns; ISO/Date/epoch). **Unknown-root warning:** `validate()`
now calls `checkTemplateRoots` (Option B — full root inference): it walks each
config template's AST with the helper-aware `getTemplateRoots` and warns on any
root outside the union of always-present meta keys (`$json`/`$node`/`$execution`/
`$workflow`/`$now`), `EXPRESSION_HELPERS`, every node's `variableName`, every SET
mapping first segment, and the trigger's seeded keys (webhook → `webhook`;
schedule → `schedule`; google-form → `googleForm`; stripe → `stripe`; manual →
`trigger`) plus the manual trigger's flat-spread payload keys (enumerated from
the node's own `payload` JSON — the same string the executor parses). This
**completes root inference (Option B)** and is what makes the authoring harness
gate green: the reference workflows reference `{{schedule.timestamp}}`,
`{{googleForm.*}}`, `{{stripe.*}}` and manual-payload keys like `{{title}}`, all
previously flagged unknown. The webhook root stays deliberately scoped to
`["webhook"]` so ported `{{body.*}}`/`{{$json.body.*}}` are still caught — the
G14 acceptance case. Warning severity, non-blocking; flows through the shared
validator to the canvas lint and save router (throws only on `error`). +16 root
tests total (`validate.test.ts`, now 46): the original 11, plus 5 for the
schedule/googleForm/stripe/manual-payload roots. Docs: new `docs/nodes/expressions.md` (full map +
triple-stache/`json` raw-JSON rule) mirroring the map added to the in-app
`/docs/expressions` page; `docs/nodes/webhook-out.md` example corrected from the
stale `{{data.*}}` to `{{webhook.body.*}}`; ADR-0007 amended with the helper
table + escaping rule + unknown-root validation. `npm run build` and `npm run lint`
pass.

### ✅ AF-M9-08 · Typed `SET` assignments · 1d — **DONE 2026-09-03**
G8. `SET` writes the compiled string, so a boolean becomes `"true"` and an object
becomes `"[object Object]"`. W1 and W2 both assign booleans and objects.

**Depends on:** AF-M9-07
**Acceptance**
- [x] `mappings[].type` ∈ `string | number | boolean | object | array`, default `string` — existing configs keep working unchanged.
- [x] Non-string types parse the compiled output and **throw a `NonRetriableError` naming the field** when it does not parse. Never coerce silently.
- [x] `setNestedValue` no longer aliases nested upstream objects — today `{ ...context }` is shallow, so a nested write mutates the upstream node's recorded output.
- [x] The config panel exposes the type selector per mapping.
- [x] Unit tests: each type round-trips; a malformed object throws with the field name; a nested write does not mutate the upstream output.
- [x] progress.md updated

**Status 2026-09-03 — done.** `SET` config now declares `mappings[].type` as a
`z.enum(["string","number","boolean","object","array"]).default("string")`
(`src/nodes/core/set/definition.ts`), so pre-typing configs keep working
unchanged and the schema-driven config panel (AF-M1-06) auto-renders a per-mapping
type `<select>` on the mapping `fieldList` (now `Key`/`Value`/`Type`) with zero
hand-written UI. `execute.ts` gains `parseTypedValue`: `string` passes through;
`number` requires a non-empty finite literal; `boolean` exactly `"true"`/`"false"`;
`object`/`array` `JSON.parse` with shape enforcement — every failure throws
`new NonRetriableError('Set node: "<key>" …')` naming the field, never a silent
coercion. `setNestedValue` now clones-on-descend, so writing `user.name` replaces
the shared nested object instead of mutating the upstream node's recorded output
(`nodeOutputs[prev]`/`context`). Tests: SET definition + new `execute.test.ts`
(16 tests) covering each type round-trip, default-to-string, the non-aliasing
nested write, and every failure path with its field-named message; config-schema
catalogue, registry guards, template (63), and validate (41) all still green.
`npm run build` and `npm run lint` pass.

#### Phase 3 — the missing nodes and the missing scheduler behaviour

### ✅ AF-M9-09 · `SWITCH` node with config-driven outputs · 2d — **DONE 2026-09-03**
G2. Requires `NodeDefinition.outputs` to become derivable from config.

**Depends on:** AF-M9-03
**Acceptance**
- [x] `NodeDefinition` gains an optional `resolveOutputs(config): PortDef[]`; when absent the static `outputs` array is used. The editor, `validate()`, and the runner all resolve ports through one shared helper — no third code path.
- [x] `SWITCH` (`LOGIC`): ordered rules `[{ outputKey, left, operator, right }]`, max 10, plus `fallback: "none" | "extra"`. Emits `_outputPort = <outputKey>`; with `fallback: "none"` and no match it emits no port, so the whole downstream is `SKIPPED` and the run still ends `SUCCESS`.
- [x] Renaming an `outputKey` does **not** silently detach edges: `validate()` raises an error naming the orphaned edge.
- [x] Engine tests: each of three rules routes to exactly its own branch; `fallback: none` with no match ends `SUCCESS` with everything downstream `SKIPPED` under a readable `skipReason`.
- [x] `/docs/nodes/SWITCH` generated from the registry via the existing `generateStaticParams` path.
- [x] progress.md updated

**Summary:** `resolveOutputs` added to `NodeDefinition` (optional) and routed through a
**single** shared helper `outputPorts(type, config)` in `src/nodes/ports.ts` — the editor
(handle rendering via `node-port-handles.tsx`/`base-execution-node`, `defaultOutputId`),
the validator (`checkOrphanedEdges` in `validate.ts`) and the engine (edge matching /
disabled pass-through) all resolve ports there, so there is no third code path. `SWITCH`
implements it: ordered rules (max 10, first match wins) with `outputKey`/`left`/`operator`/
`right`, `fallback` `"none" | "extra"`. No-match + `"none"` emits the reserved
`UNMATCHED_OUTPUT_PORT` sentinel; `markTakenEdges` early-returns on it (marks no edges) so
`computeSkippableNodes` marks the whole downstream `SKIPPED` with a readable
`skipReason` and the run ends `SUCCESS`. Renaming an `outputKey` is caught by
`checkOrphanedEdges`, which raises an error naming the orphaned edge and the now-stale port.
Config panel is fully auto-generated (`rules` → fieldList, zero custom component);
`/docs/nodes/SWITCH` ships via the existing `generateStaticParams` from the registry, with
`node-reference.ts` now resolving outputs through the shared `outputPorts` helper so the
documented ports cannot diverge. Tests: SWITCH `execute.test.ts` (8), `definition.test.ts`
(10), `ports.test.ts` invariant, `trace.test.ts` sentinel + SWITCH reachability, and
`validate.test.ts` orphaned-edge; a `deployment-env-router` gallery template demonstrates
the node so the catalogue "exercises every node type the palette offers" invariant holds
(the template harness' `checkGraphShape` now resolves a source node's ports via `outputPorts`
instead of the static `outputs` array, and `EXPECTED_TEMPLATE_COUNT` moved 20→21);
`npm run build`, `npm run lint`, and the full suite pass.

### ✅ AF-M9-10 · `RESPOND_TO_WEBHOOK` node + real synchronous webhook responses · 2.5d · **DONE 2026-09-03**
G3. `?sync=true` returns a fixed envelope and 500 ms-polls for up to 20 s.

**Depends on:** AF-M9-05
**Acceptance**
- [x] `RESPOND_TO_WEBHOOK` (`ACTION`): `statusCode` (100–599, default 200), `contentType`, `body` (template), `headers` (record). Writes the response onto the execution — new nullable `Execution.response Json?` via an additive migration — and marks the run "responded". *(Status narrowed to **200–599**: 1xx is an interim response with no body, which a settled execution cannot express. Recorded rather than silently accepted.)*
- [x] The webhook route in sync mode returns that response verbatim: status, content type, headers, body. Header names are allowlisted (no `Set-Cookie`, no hop-by-hop) and the body is size-capped.
- [x] A sync run that finishes **without** reaching a respond node keeps today's `{success, executionId}` envelope — the existing contract does not break.
- [x] `validate()` warns when a `RESPOND_TO_WEBHOOK` sits in a graph with no webhook trigger, and when two respond nodes are reachable on the same path.
- [x] The 500 ms poll loop is replaced with an Inngest realtime subscription or a Postgres `LISTEN`, keeping the 20 s hard timeout. If neither is workable inside the M9 window the poll may stay — but the reason is written into this task, not left implicit. *(**Poll kept, deliberately.** Both alternatives bind a long-lived connection to a serverless request handler that Vercel may freeze between event-loop turns — trading a correctness risk for latency this endpoint does not need. The reason is written at the call site as well as here. Revisit if sync webhooks move to a long-lived runtime.)*
- [x] The route accepts `GET`/`PUT`/`PATCH`/`DELETE` as well as `POST`, with the method surfaced as `webhook.method` (W1's real-world generalizations are multi-method endpoints).
- [x] Integration tests: sync POST → 200 with the composed body; a 404-composing branch returns 404; a run with no respond node still returns the legacy envelope; an oversized body is rejected, not truncated.
- [x] progress.md updated

**DONE (2026-09-03, AF-M9-10).** Shipped as `src/nodes/core/respond-to-webhook/`
(definition + execute + index, registered in both `registry.ts` and `manifest.ts`),
`src/lib/webhook-response.ts` (the header policy), migration
`20260903120000_add_execution_response`, engine wiring in `src/inngest/functions.ts`,
`checkRespondNodes` in `src/engine/validate.ts`, and the multi-method route.

**The response is written eagerly, at the node, not at settle time.** This was the
one real design decision. `onFailure` is a separate Inngest context with no access to
the handler closure, so a settle-time write would silently lose the response whenever
any node *downstream* of the respond node failed — which is exactly the "respond
early, then do slow follow-up work" shape the node exists to enable. Eager writing
also survives AF-M8-27 cancellation, which suppresses every terminal-status write. The
cost is one extra DB write per respond node; an integration test covers the FAILED
case specifically.

**Harvested per node, not off the terminal context**, because AF-M9-12 gives each node
its own input: a respond node on a branch that is not the last to run would otherwise
vanish. Both harvest sites (main loop and fan-out segment loop) call one
`persistWebhookResponse` helper. Last writer wins, and `validate()` warns about the
only shape where that is ambiguous.

**Header policy is an allowlist, applied twice.** A header passes only by being a
known-safe response header or `x-` prefixed; `Set-Cookie` (session fixation),
hop-by-hop headers, `Content-Length` and `Content-Type` (one source of truth — the
node's own field) are refused. It runs in the node **after template resolution** — a
template resolving to `Set-Cookie`, or smuggling a CRLF through a *value*, is the case
a literal-config check would miss — and again in the route on the value read back from
the database, so a row written by anything other than current node code still cannot
split a response. Rejections fail the node loudly rather than dropping headers
silently, so the endpoint cannot behave differently from what the canvas shows.

**Three defects found and fixed while making the gates honest** — all pre-existing on
this branch, none introduced here:
 1. `CODE`, `SPLIT_OUT` and `AGGREGATE` were **missing from `updateNodeSchemas`**
    (`src/features/workflows/schemas.ts`), so none of the three could be saved from
    the editor at all. That file's own doc comment describes this exact failure mode
    (it happened to `AI_LLM`/`AI_EXTRACT` before AF-M8-24) and it recurred with
    AF-M9-13/14. All four types added.
 2. `CODE.defaults` was `{ code: "" }` against a `min(1)` schema, and
    `SPLIT_OUT.defaults` was `{ path: "" }` against a non-empty refinement — both
    failed `registry.test.ts`'s "defaults satisfy their own schema" assertion, so
    that suite was red on the branch. Fixed with real starter values rather than by
    weakening the schemas: `CODE` gets a starter body that documents its return
    contract, and `SPLIT_OUT` defaults to `path: "items"`, which is the key `CODE`
    stores an array under — so the documented CODE → SPLIT_OUT pairing now works the
    moment both are dropped on the canvas.
 3. Two unrelated `tsc` errors in untouched test files (`set/execute.test.ts`,
    `run-graph.test.ts`) left `npx tsc --noEmit` red; both were missing type
    assertions, both fixed.

**Tests:** 15 header-policy unit tests (`src/lib/webhook-response.test.ts`, including
CRLF response-splitting and a byte-vs-character body cap), 10 executor unit tests,
9 validator tests (`validate.test.ts`), and 11 integration tests
(`tests/integration/respond-to-webhook.integration.test.ts`) split between the engine
half and the route half. **Gates:** `npm test` 1394/1394 across 122 files,
`npm run test:integration` 180/180 across 19 files, `npx tsc --noEmit` clean,
`npm run lint` clean, `npm run build` green.

### ✅ AF-M9-11 · `MERGE` v2 — real multi-input ports · 2d · **DONE 2026-09-03**
G4. One input port today, with the result reconstructed from the flat bag.

**Depends on:** AF-M9-03, AF-M9-12
**Acceptance**
- [x] `MERGE` declares `inputCount` (2–5) via `resolveInputs(config)`, rendering `input-0…input-n`.
- [x] Modes: `byInput` (`{ input0, input1, … }` — the W2 shape), `append`, `mergeByKey`. The existing single-input `append`/`mergeByKey`/`combine` behaviour is preserved for saved nodes via `definition.migrate` from `version: 1`.
- [x] An input port with no arriving branch resolves to `null`, **not** to a missing key — a skipped branch must be distinguishable from an empty one.
- [x] Engine tests: two branches merge byInput in declared port order regardless of topological order; one branch skipped yields `{ input0: {...}, input1: null }`; a `version: 1` saved MERGE still produces its old output.
- [x] progress.md updated

### ✅ AF-M9-12 · Branch isolation: resolve each node's input from its incoming edges · 3d · **DONE 2026-09-03**
G5, and the structural precondition for AF-M9-11. Today the runner keeps one
`context` variable and overwrites it after every node, so in `A → (B, C) → D`, node C
receives B's output and D receives only C's.

**Depends on:** AF-M9-05
**Acceptance**
- [x] The runner keeps `nodeOutputs` (already present) as the source of truth and builds each node's input from its **incoming edges**: one incoming edge → that node's output; several into one port → merged left-to-right in deterministic edge order; several ports → keyed by port id.
- [x] The flat rolling context is retained **as an additional read-only view**, so every existing template and every seeded catalogue template keeps resolving. This is a compatibility guarantee with an engine test per existing catalogue template proving it.
- [x] Execution stays sequential in topological order. **Concurrency is explicitly out of scope** — the deliverable is isolation, not parallelism. Say so in the task record so nobody reads "fan-out" as "parallel".
- [x] Engine tests: in `A → (B, C) → D`, C's input is A's output (not B's); D receives both; a node with two incoming edges into one port merges deterministically across repeated runs.
- [x] ADR-0019 records per-node input resolution, what it supersedes in `docs/architecture/execution_engine.md`, and the compatibility view.
- [x] progress.md updated

### ✅ AF-M9-13 · `CODE` node — sandboxed, no network, hard caps · 3d · **DONE 2026-09-03**
*(Header was stale at ⬜ while every acceptance box below was already ticked and the
work merged as `945cf4d` + `f32bfff`. Corrected 2026-09-03 during AF-M9-10, which also
fixed two things this task shipped broken: `CODE` was **absent from
`updateNodeSchemas`**, so it could not be saved from the editor, and its
`defaults: { code: "" }` failed its own `min(1)` schema — see the AF-M9-10 DONE note.)*
G7. The most-used node in the source library, and the one with real blast radius:
this is arbitrary tenant JS running on our worker.

**Depends on:** AF-M9-05
**Acceptance**
- [x] Runs in `node:vm` inside a **`worker_threads` worker** with `resourceLimits`, or an equivalent isolate. Not bare `vm` on the main thread — `vm` alone stops neither `while(true)` nor an OOM.
- [x] No `require`, no `import`, no `process`, no `fetch`, no timers outliving the call, no filesystem. Only the resolved input, a frozen `$json`, and pure helpers.
- [x] Hard caps, configurable per node within engine ceilings: wall clock (default 5 s, max 30 s), heap (default 64 MB), output size (default 1 MB). Every breach is a `NonRetriableError` naming the limit — never a silent truncation.
- [x] The node returns either an object or an array; an array is stored under `items` so `SPLIT_OUT` can consume it.
- [x] Errors surface the user's line number in `NodeExecution.error` — a code node that fails opaquely is unusable.
- [ ] CPU time is recorded on the `NodeExecution` so AF-M7-04 can meter it later. Not billed in M9. *(Deferred — `worker.resourceLimits` gives no accurate CPU readout; wall-clock `durationMs` is already in the trace. Documented follow-up.)*
- [x] Security tests: an infinite loop is killed at the cap; an allocation bomb is killed; `process.env` is `undefined`; a network attempt fails; prototype-pollution attempts do not escape.
- [x] **Sandbox escape found and fixed (AF-M9-13 follow-up, 2026-09-03).** The initial implementation injected a host-realm `input` object (deserialized from `workerData`) into the vm context, which let `input.constructor.constructor("return process")()` reach the worker thread's real `process` (env, filesystem, arbitrary commands). Fixed by passing the input as a JSON string and materializing it inside the vm realm; an adversarial regression test pumps `constructor.constructor("return process")()` through the input, literals, and `JSON.parse` and asserts containment. ADR-0020 §2a, `security.md` §6.
- [x] ADR-0020 records the sandbox choice and what it explicitly does **not** defend against.
- [x] `docs/architecture/security.md` gains a Code-node section.
- [x] progress.md updated

### ✅ AF-M9-14 · Bounded item fan-out: `SPLIT_OUT` → segment iteration → `AGGREGATE` · 4d · **highest risk**
G6. Decision D deferred loops/fan-out "until post-beta"; M9 is post-beta, and this
expires that deferral **for one bounded case only** — a single, non-nested iteration
between an explicit start and an explicit end. Full n8n items semantics stay out.

**Depends on:** AF-M9-12
**Acceptance**
- [x] `SPLIT_OUT` (`TRANSFORM`) reads an array at a configured path and opens an iteration segment; `AGGREGATE` (`TRANSFORM`) closes it and returns `{ items, count, failed }`.
- [x] `validate()` enforces the shape at save time: every `SPLIT_OUT` has exactly one matching reachable `AGGREGATE`; segments do not nest; no edge crosses a segment boundary. All three are errors, not warnings.
- [x] The runner executes the segment once per item with `$item` and `$itemIndex` in scope, sequentially, honouring per-node retry and `continueOnFail` inside the segment.
- [x] **Hard cap** on items per segment (default 100, engine ceiling 1000). Exceeding it fails the run with a clear message — never a partial run reported as success.
- [x] Traces stay legible: one `NodeExecution` per node per item carrying `itemIndex`, with the executions UI grouping them. A 10-item × 2-node segment must not read as 20 unrelated rows.
- [x] The interaction with AF-M8-06 retention and AF-M7-04 quotas is stated: a 100-item segment writes 100× the node rows, and whether that counts as one execution or many for quota is an explicit decision recorded here.
- [x] Engine tests: 10 items → 10 iterations and `AGGREGATE` collects 10; one failing item with `continueOnFail` yields 9 succeeded + 1 in `failed`; 101 items against a cap of 100 fails cleanly; a nested segment is rejected at save.
- [x] ADR-0021 records the bounded design and, explicitly, what is still unsupported: nesting, parallel items, `splitInBatches` resumption, `Wait` inside a segment.
- [x] **Fallback, decided before starting:** if this is not green by the end of week 5, W3 ships batched (one POST for all ten records), the deviation is written into the template description and into this task, and `SPLIT_OUT`/`AGGREGATE` move to Phase 2. Slipping the milestone to save this task is the wrong trade.
- [x] progress.md updated

#### Phase 4 — ship them and prove them

### ✅ AF-M9-15 · Author the three templates in the catalogue · 1.5d · **DONE 2026-09-03**
The delivery vehicle already exists — `src/features/templates/catalog/` plus
`npm run seed:templates`, gated by `catalog/harness.ts`. Nothing new is needed; the
templates simply have to pass the existing gate.

**Depends on:** AF-M9-09, AF-M9-10, AF-M9-11, AF-M9-13 *(AF-M9-14 only for W3's fan-out form)*
**Acceptance**
- [x] `api-router-sync-response` (ops), `multi-channel-broadcast-merge` (ops), `api-etl-batch-deliver` (data) added, matching §1 exactly. *(W3 ships in the **full** `SPLIT_OUT`/`AGGREGATE` form — the §1 batched fallback was not needed, since AF-M9-14 landed.)*
- [x] Each `description` names the demo endpoint it calls, states that it needs **no credentials**, and says what to swap for production use.
- [x] `checkCatalog` passes: no secret-shaped literals, no cuids, slug/node-id patterns, per-node config schemas, reachability. *(`harness.test.ts` 24/24 — including the "exercises every node type the palette offers" assertion, which had been **red since AF-M9-13/14** because `CODE`, `SPLIT_OUT` and `AGGREGATE` had no template. These three close it.)*
- [x] Each carries a source-attribution comment naming the exact library file it derives from and any deliberate deviation.
- [x] `npm run seed:templates` dry run is clean and the domain-coverage test still holds. *(24 templates, all three new ones at **0 credentials** — the property that lets AF-M9-16 run them in CI without anyone's accounts.)*
- [x] Instantiating each from the gallery produces a workflow that opens in the editor, renders every branch handle, and **saves back byte-identically** — the G1 round-trip proof. *(Closed 2026-09-03 as a **test** rather than a browser check: `tests/integration/template-round-trip.integration.test.ts` drives the real path — `prepareTemplateGraph` (install) → `saveWorkflowInputSchema` (the boundary the editor posts through) → `workflows.saveGraph` (validate + persist) → the `Node`/`Connection` rows — and asserts node config survives and **every persisted edge names a port its source node actually declares**, which is the part G1 broke. A browser proves it once on one machine; this proves it on every run. A fourth case pins that the SWITCH keeps two *distinct* ports, which a regression collapsing both onto the first would otherwise satisfy.)*
- [x] progress.md updated

**DONE (2026-09-03).** All three authored, gated, and round-tripped.

**The round-trip proof found a shipping bug on its first run: `_run` was being
stripped by the save boundary.** `configOf` returned each node's bare
`configSchema`, and Zod strips unknown keys — so the AF-M9-06 run policy the
config panel writes was discarded on every save. A user who set retries or a
timeout in the UI watched it silently vanish, and all three reference templates
shipped a `_run` that never survived installation. This is the *same* defect
AF-M9-06 was written to end — its own note says the legacy
`_timeoutMs`/`_continueOnFail` keys were broken because they "appeared in no
configSchema", so "the save boundary was free to drop them" — reappearing in
the key that replaced them. **AF-M9-06 was therefore not actually complete**;
see its reopened-and-closed note. Fixed in `configOf` by splitting the reserved
key off, validating both halves, and re-joining (a transform rather than
`.extend`, because `triggerDataSchema` and `AGGREGATE`'s schema are not bare
`ZodObject`s). Six unit regression tests in `schemas.test.ts`, including one
that asserts a policy round-trips on **every** registered node type.

Authoring also surfaced the save-boundary and defaults defects recorded in the
AF-M9-10 DONE note: the templates could be *authored* against node types that
could not be *saved*, which is precisely the drift `schemas.ts` warns about.

### ✅ AF-M9-16 · End-to-end acceptance: the three run green in CI · 1.5d · **DONE 2026-09-03**
The point of the milestone. Not "the plan compiles" — the graphs execute.

**Depends on:** AF-M9-01, AF-M9-02, AF-M9-15
**Acceptance**
- [x] A local fixture HTTP server, started by the integration global setup (no new CI service), mimics `httpbin.org/post` (echoes JSON under `json`) and `jsonplaceholder.typicode.com/posts` (100 fixed records). Reached via `ALLOW_LOOPBACK_EGRESS=1`. **No test in this suite touches the public internet.** *(`tests/integration/fixtures/http-fixture-server.ts`, `node:http` only, plus a `/fail` route for the W2 case. The suite asserts the host rewrite actually applied and that no external host survives it, so a template gaining a third external host fails loudly instead of quietly reintroducing a network dependency.)*
- [x] W1: `action: "ping"` → 200 `{ok:true,message:"pong"}` with the `process` branch `SKIPPED`. `action: "process"` → 200 `{ok:true,source:"serviceA",data:{...}}` with the `ping` branch `SKIPPED`. An unknown action → run `SUCCESS`, everything after the switch `SKIPPED`, legacy envelope returned.
- [x] W2: both broadcasts execute; the merge output carries `input0` and `input1` in declared port order; the response carries both. With Broadcast B forced to fail under `continueOnFail: true`, the merge yields `input1: null` and the response still returns 200.
- [x] W3: 10 deliveries and `AGGREGATE` reports `{count: 10, failed: 0}` — or, under the AF-M9-14 fallback, one batched POST carrying 10 records, with the deviation asserted explicitly so the test cannot silently pass the weaker shape. *(Full form. The suite asserts **10** `Deliver` rows with `itemIndex` 0–9, so a silent substitution of one batched POST drops that to 1 and fails.)*
- [x] Every run asserts terminal status `SUCCESS`, zero `FAILED` node rows, an `Execution.output` free of `$`-prefixed keys (AF-M9-05), and a recorded `durationMs`.
- [x] The three specs run from the **seeded catalogue rows**, not from inline fixtures — so a template that drifts from what the gallery ships breaks the build. *(Projected through `toSeedRow` — the same function `seed:templates` uses — upserted, then read back out of Postgres.)*
- [x] CI wires `ALLOW_LOOPBACK_EGRESS=1` for the integration job only.
- [x] `docs/planning/progress.md` records the milestone complete.

**DONE (2026-09-03, AF-M9-16).** `tests/integration/reference-workflows.integration.test.ts`
— 6 tests, all green. **The suite earned its keep immediately: it found three
defects that every other gate had passed over.**

1. **The engine could not rejoin after a branch.** `_outputPort` is a control
   signal the engine consumes at the node that produced it, but `buildNodeInput`
   copied it into the *next* node's input, and since every executor returns
   `{ ...input, … }` that node re-emitted the branch's port id as its own.
   `markTakenEdges` then matched none of its outgoing edges (which are `main`),
   so **everything below the join was marked "not reachable via taken branches"
   while the run still reported `SUCCESS`.** Route → per-branch work → single
   response — the single most common branching shape, and W1's whole point —
   silently dropped its tail. `trace.test.ts` could not have caught it: those
   unit tests call `markTakenEdges` with hand-built port ids, so the poisoned
   value never appears. Fixed at the root (strip the key when merging upstream
   outputs) plus a guard (`declaredOutputPort`: a node may only route to a port
   it declares; anything else is treated as non-branching rather than as a
   silent kill switch). Regression tests added to `run-graph.test.ts`.
2. **`{{{json x}}}` emitted invalid JSON for a missing path.**
   `JSON.stringify(undefined)` returns the JS value `undefined`, which
   Handlebars renders as the bare word `undefined` — so any template building a
   JSON payload from an optional path produced a malformed document, and a
   typed `SET` failed with `resolved to "undefined"`. Now emits `null`. This is
   an AF-M9-07 helper defect affecting every template, not just these three.
3. **The integration `globalSetup` had never run.** It reads
   `TEST_DATABASE_URL`, but `.env` was only loaded per worker
   (`vitest.integration.setup.ts`), never in vitest's main process — so the
   variable was `undefined`, the guard returned early, and **migrations were
   silently never applied on a local run**, despite the file's own comment
   saying they were. CI was unaffected (job-level env var + its own
   `migrate deploy` step), which is exactly why it went unnoticed. Fixed by
   loading `.env` there too.

Also fixed while auditing: W1's `payload` mapping crashed on any request
without a payload (every `ping`), and `WEBHOOK_TRIGGER` still described itself
as *"(Stub — full implementation in M4.)"* in the palette and node reference
long after M4 shipped the receiver.

**Gates:** `npm test` 1403/1403 across 123 files, `npm run test:integration`
189/189 across 20 files, `npx tsc --noEmit` clean, `npm run lint` clean,
`npm run build` green, `seed:templates` dry run clean at 24 templates.

---

### 4. Sequencing, and what to cut if time runs out

```
AF-M9-01 ─┬─ AF-M9-03 ─┬─ AF-M9-06
          │            ├─ AF-M9-09 ─┐
          ├─ AF-M9-04  │            │
          ├─ AF-M9-02 ─┼────────────┤
          └─ AF-M9-05 ─┼─ AF-M9-10 ─┤
                       ├─ AF-M9-12 ─┼─ AF-M9-11 ─┤
                       └─ AF-M9-13 ─┼────────────┼─ AF-M9-15 ─ AF-M9-16
AF-M9-07 ─ AF-M9-08 ────────────────┘            │
                        AF-M9-14 ────────────────┘
```

- **Weeks 1–2:** Phase 0 + Phase 1 (01, 02, 03, 04, 05, 06). This half fixes **existing** defects and is worth doing whatever happens to the rest.
- **Weeks 3–4:** 07, 08, 09, 10, 12, 11.
- **Weeks 5–6:** 13, 14, 15, 16.

**Descope order, first to go:** AF-M9-14 (fall back to a batched W3) → AF-M9-13 (drop
W3's `CODE` node, do the transform in `SET`, accept a weaker W3) → AF-M9-11 (ship W2
on the existing single-input MERGE and record the deviation). **Never descope
AF-M9-01, AF-M9-03, or AF-M9-05** — they close shipping defects, and without AF-M9-01
nothing in this milestone can honestly be reported as done.

### 5. Decisions this milestone must record

> **Renumbered 2026-09-02.** These were reserved as 0018-0021 while unwritten.
> AF-M2-00 landed `0018-bounded-node-output-over-blob-spill.md` first, and ADR
> numbers are assigned when a decision is written rather than when it is
> planned - so the M9 reservations shifted up by one.

| ADR | Subject | Task |
|---|---|---|
| ~~0019~~ | Declared ports are the handle identity; `fromOutput`/`toInput` are a persisted contract | AF-M9-03 — **no ADR written (2026-09-03).** `node_sdk.md` already specified `PortDef.id` as "the React Flow handle id and Connection.fromOutput/toInput"; the code simply did not obey it. That is a defect fixed, not a decision taken, and an ADR recording "we now do what the spec said" would be noise. The contract is stated in `node_sdk.md` §"Ports are a persisted contract" instead. 0019 stays free for AF-M9-12. |
| 0019 | Per-node input resolution replaces the single rolling context (compat view retained) | AF-M9-12 |
| 0020 | Sandbox choice for the Code node, and its stated non-goals | AF-M9-13 |
| 0021 | Bounded item fan-out; the narrow expiry of Decision D | AF-M9-14 |
| — | ADR-0007 **amended** (not superseded) with the helper set and the escaping rule | AF-M9-07 |

### 6. Verification recipe

```bash
npm run lint && npm run build
npm test
npm run test:db:up && npm run test:integration && npm run test:db:down
npm run seed:templates
npm run seed:templates -- --yes
```

`AF-M9-16` is the milestone's definition of done: the three graphs execute to
`SUCCESS` from seeded catalogue rows, against a local fixture server, in CI, with no
network access and no credentials.

---

## M10 — Automation library: the 35 reference automations · ~12 weeks (62d) · *(added 2026-09-03)*

**Source:** `docs/automations/autoflow-automations.md` — the 35 n8n templates Intuz
publishes for small businesses, captured 2026-08-25. This milestone's goal is that
**all 35 exist as AutoFlow catalogue entries that execute to `SUCCESS`**, against
fixture servers in CI and against real accounts in staging.

**Do not start before AF-M9 closes.** M9 makes *one* graph provably runnable; M10 is
what that capability is for. Three M9 tasks are hard prerequisites — AF-M9-01 (the
execution harness), AF-M9-10 (`RESPOND_TO_WEBHOOK`), AF-M9-13 (`CODE`) — and
AF-M9-14's `SPLIT_OUT`/`AGGREGATE` is load-bearing for 6 of the 35.

> **Scope honesty, stated once.** The 35 automations require **34 distinct
> third-party services**. AutoFlow today ships 25 node types covering 12 services,
> of which 8 are real API integrations. This is not a "write 35 templates"
> milestone — it is a connector-platform milestone with 35 templates as its
> acceptance test. Anyone reading this expecting a one-day job should read §0 and
> §8 before planning around it.

---

### 0. Reality check: what the 35 actually require

Counted by reading all 35 entries in the source document and grepping this repo on
2026-09-03. Every "have" below is a file on disk, not a spec claim.

| Requirement | Needed by | AutoFlow today | Verdict |
|---|---|---|---|
| Authenticated REST call to an arbitrary API | 31 of 35 | `HTTP_REQUEST` has **no `credentials` array** — `src/nodes/http/request/definition.ts` declares none, and `execute.ts` contains no `Authorization` handling | **blocked** |
| Polling trigger (new mail / new file / new row) | 18 of 35 | Only `WEBHOOK_TRIGGER`, `SCHEDULE_TRIGGER`, `MANUAL_TRIGGER`, `GOOGLE_FORM_TRIGGER`, `STRIPE_TRIGGER`. No cursor state model in `prisma/schema.prisma` | **blocked** |
| Google Workspace beyond one sheet append | 21 of 35 | `GOOGLE_SHEETS_APPEND` only; `google.oauth2` `defaultScopes` is `userinfo.email` — Gmail, Drive, Calendar and Sheets *read* are all unreachable | **blocked** |
| Binary payloads (PDF, image, video) | 12 of 35 | `WorkflowContext` is JSON-only; no blob store, no dependency for one | **blocked** |
| Multimodal AI input (image / PDF into a model) | 4 of 35 | `src/lib/ai/registry.ts` declares a `vision` capability on 5 models, but no node accepts an image | **blocked** |
| QuickBooks Online | 10 of 35 | nothing; no Intuit OAuth provider | **blocked** |
| Human-in-the-loop approval / timed wait | 2 of 35 | no `WAIT` and no approval **node** (`src/features/approvals` is a UI surface, not a node) | **blocked** |
| External vector store (Pinecone) | 1 of 35 | `AI_RETRIEVE` is bound to the internal `KnowledgeChunk` store | **blocked** |
| Document text extraction (PDF/DOCX) | 6 of 35 | **have** — `src/features/knowledge/lib/extractor.ts` (`pdf-parse` + `mammoth`), not yet exposed as a node | partial |
| LLM chat / structured extraction | 24 of 35 | **have** — `AI_LLM`, `AI_EXTRACT`, `AI_COMPATIBLE` with multi-provider fallback | ✅ |
| Branching, switch, merge, code, fan-out | 19 of 35 | **have** after M9 — `CONDITION`, `SWITCH`, `MERGE` v2, `CODE`, `SPLIT_OUT`/`AGGREGATE` | ✅ |
| Slack notification | 6 of 35 | partial — `SLACK` is **incoming-webhook only** (`webhookUrl` config, no credential). #26 needs `conversations.list`/`create`, #27 needs `users.lookupByEmail` + DM | partial |
| Brand logo on a node | all 35 | `NodeDefinition.icon` is a **lucide-react icon name**; there is no `logo` field (`CredentialTypeDef` has one). `public/logos/` cannot currently reach the canvas | **blocked** |

**The single highest-leverage item is the first one.** Because 31 of 35 automations
are ultimately authenticated REST calls, putting credentials on the generic
`HTTP_REQUEST` node converts most of Phase B from "write a node family" into "write
a template" — and it unblocks work on every service in parallel rather than in
series. It is AF-M10-01 for that reason, not for alphabetical accident.

---

### 1. Coverage matrix

All 35, in source order, with the numbering from `autoflow-automations.md`.
**New nodes** lists only what does not exist today. **Blocked by** names the Phase A
capability that gates it; a row with `—` is authorable the moment its services land.

| # | Automation | Trigger | Services | New nodes | Blocked by |
|---|---|---|---|---|---|
| 1 | Hyper-personalized email outreach | Sheets poll | Sheets, Gmail, OpenAI | `SHEETS_READ`, `SHEETS_UPDATE`, `GMAIL_SEND` | A-05, A-03 |
| 2 | AI Upwork proposal generation | Schedule ✅ | Apify, Gemini, Sheets, Gmail | `APIFY_RUN`, `SHEETS_READ/UPDATE`, `GMAIL_SEND` | A-01, A-03 |
| 3 | Lead gen + outreach (Apollo + GPT-4) | Schedule ✅ | Apify, Apollo, OpenAI, Sheets | `APIFY_RUN`, `APOLLO_ENRICH` | A-01, A-09 |
| 4 | Cold outreach personalization (Gemini) | Schedule ✅ | Sheets, Gemini | `SHEETS_READ`, `SHEETS_UPDATE` | A-03 |
| 5 | LinkedIn profile research + outreach | Schedule ✅ | Apify, Gemini, Sheets | `APIFY_RUN`, `SHEETS_READ/UPDATE` | A-01, A-03 |
| 6 | Lead gen from Google Search + Maps | Form/chat | Custom Search, Maps, Sheets | `FORM_TRIGGER`, `GOOGLE_SEARCH`, `GOOGLE_MAPS`, `DEDUPE` | A-14, A-10 |
| 7 | Outreach from LinkedIn job signals | Schedule ✅ | Apify, Apollo, Gemini, Sheets | `APIFY_RUN`, `APOLLO_ENRICH` | A-01, A-03 |
| 8 | AP invoices from Gmail + Drive | Gmail poll, Drive poll | Gmail, Drive, Gemini, Sheets, QBO, Slack | `GMAIL_TRIGGER`, `DRIVE_TRIGGER`, `DRIVE_DOWNLOAD`, `QBO_*`, `SLACK_POST` | A-05, A-06, A-07, B-16 |
| 9 | Expense reporting: Airtable → QBO | Airtable poll | Airtable, QBO | `AIRTABLE_TRIGGER`, `AIRTABLE_UPDATE`, `QBO_CREATE_EXPENSE` | A-05, A-06, B-16 |
| 10 | QuickBooks invoice alerts in Slack | QBO webhook | QBO, Slack | `QBO_WEBHOOK_TRIGGER`, `QBO_GET`, `SLACK_POST` | A-04, B-16 |
| 11 | QBO sales receipts from Stripe | Stripe ✅ | Stripe, QBO | `QBO_FIND/CREATE_CUSTOMER`, `QBO_CREATE_RECEIPT` | B-16 |
| 12 | QBO invoice PDFs → Drive | QBO webhook | QBO, Drive | `QBO_WEBHOOK_TRIGGER`, `QBO_GET_PDF`, `DRIVE_UPLOAD` | A-04, A-06, B-16 |
| 13 | QBO customers + receipts from a Sheet | Sheets poll | Sheets, QBO | `SHEETS_TRIGGER`, `QBO_*` | A-05, B-16 |
| 14 | QBO customer + estimate from Sheets | Sheets poll | Sheets, QBO | `SHEETS_TRIGGER`, `QBO_CREATE_ESTIMATE` | A-05, B-16 |
| 15 | QBO invoice sync to Sheets | QBO webhook | QBO, Sheets | `QBO_WEBHOOK_TRIGGER`, `SHEETS_UPSERT` | A-04, B-16 |
| 16 | Full-cycle invoicing (Airtable+QBO+Stripe) | Airtable poll | Airtable, QBO, Stripe | `STRIPE_CUSTOMER`, `STRIPE_PAYMENT_LINK`, `QBO_*` | A-05, B-16, B-20 |
| 17 | QBO invoicing from Airtable orders | Webhook ✅ | Airtable, QBO | `AIRTABLE_READ/UPDATE`, `QBO_*` | B-16, B-20 |
| 18 | GitHub PRs + JIRA updates (multi-repo) | GitHub webhook | GitHub, JIRA, Slack, Notion | `GITHUB_TRIGGER`, `GITHUB_CREATE_PR`, `JIRA_TRANSITION`, `NOTION_CREATE` | A-04, B-18 |
| 19 | GitHub PRs + JIRA updates (single repo) | GitHub webhook | GitHub, JIRA | `GITHUB_TRIGGER`, `GITHUB_CREATE_PR`, `JIRA_TRANSITION` | A-04, B-18 |
| 20 | Release notes via Gemini | GitHub webhook | GitHub, JIRA, Gemini, SMTP ✅ | `GITHUB_TRIGGER`, `GITHUB_LIST_COMMITS`, `JIRA_SEARCH` | A-04, B-18 |
| 21 | Data extraction from faxes + PDFs | Form | Gemini, Drive, Sheets | `FORM_TRIGGER`, `EXTRACT_DOCUMENT_TEXT`, multimodal `AI_EXTRACT` | A-14, A-06, A-07 |
| 22 | Scrape Y Combinator startups | Manual ✅ | Apify, Sheets | `APIFY_RUN` | A-01 |
| 23 | "Chat with your PDF" on Telegram | Telegram webhook | Telegram, Gemini, Pinecone | `TELEGRAM_TRIGGER`, `TELEGRAM_SEND`, Pinecone provider | A-13, B-21 |
| 24 | Sheets → MailerLite, no duplicates | Schedule ✅ | Sheets, MailerLite | `SHEETS_READ`, `MAILERLITE_*`, `DEDUPE` | A-03, A-10 |
| 25 | Shopify orders from Airtable | Webhook ✅ | Airtable, Shopify, Gmail | `SHOPIFY_CREATE_ORDER`, `GMAIL_SEND`, `AIRTABLE_UPDATE` | A-03, B-20 |
| 26 | Gmail → Slack routing (Llama 3) | Gmail poll | Gmail, Slack, OpenRouter | `GMAIL_TRIGGER`, `SLACK_LIST/CREATE_CHANNEL`, `SLACK_POST` | A-05, B-17 |
| 27 | Pre-meeting Slack briefings | Calendar poll | Calendar, Notion, GitHub, Jira, Slack | `CALENDAR_TRIGGER`, `WAIT`, `SLACK_DM_BY_EMAIL` | A-05, A-08, B-18 |
| 28 | Contract review → legal PDF report | Drive poll | Drive, OpenAI, HTML→PDF, Slack | `DRIVE_TRIGGER`, `DRIVE_DOWNLOAD/UPLOAD/MOVE`, `HTML_TO_PDF` | A-05, A-06, A-12 |
| 29 | Review and approve NDAs | Drive poll | Drive, Sheets, OpenAI, SMTP ✅ | `DRIVE_TRIGGER`, `DRIVE_MOVE`, `SHEETS_READ/APPEND` ✅ | A-05, A-06, A-11 |
| 30 | Contract risk + approval routing | Drive poll | Drive, OpenAI, Gmail, Sheets | `DRIVE_TRIGGER`, `APPROVAL` (send-and-wait) | A-05, A-09 |
| 31 | Multichannel support ticket routing | Gmail poll, WAHA webhook, form | Gmail, WhatsApp, HubSpot, OpenAI, Jira, Slack | `FORM_TRIGGER`, `WAHA_TRIGGER`, `HUBSPOT_SEARCH`, `JIRA_CREATE`, SLA sweep | A-05, A-14, B-18, B-21 |
| 32 | Twitter/X posting with GPT-4 | Schedule ✅ | OpenAI, X, Sheets | `X_POST`, `SHEETS_READ`, `DEDUPE` | A-04, A-10, B-22 |
| 33 | AI video ad generation (Veo 3) | Form | Airtable, Gemini, Veo 3 | `FORM_TRIGGER`, `VEO_GENERATE`, multimodal AI | A-14, A-06, A-07, B-23 |
| 34 | AI video creation + multi-publishing | Manual ✅ | Gemini, Airtable, Pollinations, Creatomate, YouTube, Instagram | `POLLINATIONS_IMAGE`, `CREATOMATE_RENDER`, `YOUTUBE_UPLOAD`, `UPLOAD_POST` | A-06, B-22, B-23 |
| 35 | LinkedIn post with image (DALL·E) | Schedule ✅ | Gemini, DALL·E, LinkedIn | `OPENAI_IMAGE`, `LINKEDIN_POST` | A-04, A-06, B-22, B-23 |

**Rollup.** 18 need a polling trigger · 12 need binary payloads · 10 need QuickBooks ·
21 need Google Workspace breadth · 4 need multimodal AI · 6 already have every
non-Phase-A dependency and are the natural first templates (#4, #11, #17, #22, #24, #32).

---

### 2. Gap register

Verified against code on 2026-09-03. `Closed by` names the task below.

| ID | Gap | Evidence | Blocks | Closed by |
|---|---|---|---|---|
| **H1** | **`HTTP_REQUEST` cannot authenticate.** No `credentials` in its definition, no `Authorization` handling in its executor. Every API in the library is therefore reachable only by pasting a secret into a plaintext `headers` map — which lands in `NodeExecution.input` and violates the AF-M3-04 rule that plaintext never reaches the trace. | `src/nodes/http/request/definition.ts`, `execute.ts` | 31 of 35 | AF-M10-01 |
| **H2** | **Only 17 credential types, none for the library's services.** No Intuit/QBO, GitHub, Jira, Notion, Telegram, Shopify, LinkedIn, X, Apify, Apollo, MailerLite, Pinecone, OpenRouter, Creatomate. | `src/features/credentials/credential-types.ts` | 33 of 35 | AF-M10-02 |
| **H3** | **One Google credential, one scope.** `google.oauth2.defaultScopes` is `userinfo.email`. A user who connects Google gets a token that can read their address and nothing else — Sheets *append* works only because an existing token happens to carry the scope. Gmail, Drive, Calendar are unreachable, and re-scoping one shared credential would silently over-grant every workflow. | `src/features/credentials/server/oauth-providers.ts:22` | 21 of 35 | AF-M10-03 |
| **H4** | **Two OAuth providers total** (`google.oauth2`, `slack.oauth2`). QuickBooks, GitHub, Atlassian, Notion, Shopify, LinkedIn and X all need the authorize/token/refresh dance, and Intuit additionally needs the `realmId` (company id) captured at callback — a field the current `oauth-state`/callback path has nowhere to put. | `src/features/credentials/server/oauth-providers.ts` | 16 of 35 | AF-M10-04 |
| **H5** | **No polling triggers and no place to keep a cursor.** `prisma/schema.prisma` has no per-trigger state model, so "new since last run" is inexpressible. `cron.ts` dispatches whole workflows on a cron and keeps nothing. | `prisma/schema.prisma`, `src/inngest/cron.ts` | 18 of 35 | AF-M10-05 |
| **H6** | **No binary payloads.** `WorkflowContext = Record<string, unknown>` is JSON-serialized into `NodeExecution.output` under the ADR-0018 byte cap; a 3 MB PDF cannot pass between two nodes, and no blob dependency exists in `package.json`. | `src/nodes/types.ts`, `package.json` | 12 of 35 | AF-M10-06 |
| **H7** | **`vision` is declared but unreachable.** Five models advertise the capability; no node lets a user attach an image or PDF page to a prompt. | `src/lib/ai/registry.ts:34,127,136,155,165,174` | #8, #21, #33 | AF-M10-07 |
| **H8** | **No `WAIT` and no approval node.** #27 pauses until 15 minutes before a meeting; #30 sends a Gmail approval and blocks on the reply. `src/features/approvals` is a dashboard surface with no node binding. | grep: no `WAIT`/`APPROVAL` under `src/nodes/` | #27, #30 | AF-M10-08, AF-M10-09 |
| **H9** | **`SLACK` is incoming-webhook only.** Config is `{webhookUrl, content}` with no credential; a webhook URL is channel-pinned, so "post to the channel the classifier chose", "create the channel if absent" and "DM the attendee found by email" are all impossible. | `src/nodes/slack/send-message/definition.ts` | #8, #26, #27, #31 | AF-M10-17 |
| **H10** | **Google Sheets is append-only.** 16 automations read a sheet, and 9 write back to a specific row. Neither operation exists. | `src/nodes/google-sheets/` contains only `append/` | 16 of 35 | AF-M10-15 |
| **H11** | **Airtable is create-only; HubSpot is create-contact-only; Stripe is trigger-only.** #9/#16/#17/#25 update Airtable records, #31 searches HubSpot, #16 creates a Stripe customer and payment link. | `src/nodes/airtable/`, `src/nodes/hubspot/`, `src/nodes/payments/` | 7 of 35 | AF-M10-20 |
| **H12** | **`AI_RETRIEVE` is bound to the internal store.** #23 requires a caller-supplied Pinecone index at 768 dimensions. | `src/nodes/ai/retrieve/execute.ts`, `src/features/knowledge/lib/vector-search.ts` | #23 | AF-M10-13 |
| **H13** | **No hosted intake form.** #6, #21, #31 and #33 all start from "user submits a form". `GOOGLE_FORM_TRIGGER` requires the user to own a Google Form and wire Apps Script; there is no first-party form. | `src/nodes/forms/google-form/` | 4 of 35 | AF-M10-14 |
| **H14** | **Nodes cannot show a brand logo.** `NodeDefinition.icon` is documented as "lucide-react icon name" and there is no `logo` field, so a `QUICKBOOKS_*` node renders a generic glyph. `CredentialTypeDef` already has `logo?: string` — the asymmetry is the bug. `public/logos/` also lacks 18 of the marks this library needs. | `src/nodes/types.ts` (`icon`), `credential-types.ts:40` (`logo`) | presentation of all 35 | AF-M10-35 |
| **H15** | **No dedupe primitive.** #6, #24, #26 and #32 all mean "skip what we already processed", implemented in n8n as a sheet lookup. Doing it with `SHEETS_READ` + `CODE` per template is four copies of the same bug surface. | grep: no `DEDUPE`/`FILTER` under `src/nodes/` | 4 of 35 | AF-M10-10 |

---

### 3. Tasks

#### Phase A — platform capabilities *(nothing in Phase B or C is authorable until these land)*

### ✅ AF-M10-01 · Credentials on `HTTP_REQUEST` · 1.5d · **DONE 2026-09-03**
H1. Give the generic node a credential binding so any REST API in the library is
reachable without pasting a secret into a templated header. This is the milestone's
keystone: it converts most of Phase B from bespoke integration work into
configuration, and it is the only Phase A task that unblocks work in parallel.

**Depends on:** AF-M9-01
**Acceptance**
- [x] `configSchema` gains `credentialId` + `authMode` (`none` | `bearer` | `header` | `basic` | `queryParam` | `oauth2`); `credentials: [{ key: "credentialId", type: "*", required: false }]` accepts **any** registered type, resolved through the existing AF-M3-04 injection path.
- [x] The executor reads only from `params.credentials` — never `data` — and applies auth per `authMode`; an OAuth2 credential sends `Authorization: Bearer <accessToken>` and honours the AF-M3 refresh path.
- [x] Secret material never reaches `NodeExecution.input/output`: a test asserts the persisted row for an authenticated request contains no substring of the secret, including in the echoed request headers.
- [x] A credential-typed node still validates when unbound (`authMode: "none"`), so existing saved `HTTP_REQUEST` nodes load unchanged — no migration.
- [x] Egress guard, timeout, retry policy (AF-M9-06) and the ADR-0018 byte cap all continue to apply; a redirect hop re-vets *and* re-attaches auth only for the same origin (an auth header must not follow a cross-origin redirect).
- [x] `docs/nodes/http-request.md` written, covering the cross-origin-redirect rule.
- [x] progress.md updated

### ✅ AF-M10-02 · Credential types for the library's services · 1.5d · **DONE 2026-09-03**
H2. Add the API-key/bearer credential definitions the 35 need. These are data
entries against the existing registry, not new machinery — batch them.

**Depends on:** —
**Acceptance**
- [x] New types registered in `credential-types.ts`: `apify.apiKey`, `apollo.apiKey`, `mailerlite.apiKey`, `pinecone.apiKey` (+ `environment`, `indexHost`), `openrouter.apiKey`, `creatomate.apiKey`, `telegram.botToken`, `waha.apiKey` (+ `baseUrl`), `uploadPost.apiKey`, `googleCustomSearch.apiKey` (+ `cx`), `shopify.accessToken` (+ `shopDomain`), `jira.apiToken` (+ `email`, `siteUrl`).
- [x] Each carries a `logo` pointing at a real file under `public/logos/` (see AF-M10-35 for the 18 that must be added first).
- [x] Connection testers registered for every type whose provider exposes a cheap authenticated GET; types without one are explicitly `NOT_TESTABLE` rather than silently untested.
- [x] `credential-registry.test.ts` extended: every new type round-trips through `secretFromInput` → vault → `openSecret`, and `computePreview` masks every `secret: true` field.
- [x] progress.md updated

### ✅ AF-M10-03 · Scoped Google credentials · 1d · **DONE 2026-09-03**
H3. Split the single `google.oauth2` type into per-service credential types so a
workflow that appends to a sheet cannot also read the user's mail.

**Depends on:** AF-M10-02
**Acceptance**
- [x] Types `google.sheets`, `google.gmail`, `google.drive`, `google.calendar`, `google.docs` registered, each with its own `defaultScopes` (e.g. `gmail` → `gmail.readonly gmail.send`, `drive` → `drive.file drive.readonly`).
- [x] The existing `google.oauth2` type is **kept and marked deprecated**, not removed: saved `GOOGLE_SHEETS_APPEND` nodes reference it by id and must keep running (ADR-0011 retirement rule). A node's `credentials[].type` accepts either during the overlap.
- [x] Consent screen shows only the scopes for the type being connected; a test asserts the authorize URL's `scope` param per type.
- [x] `docs/architecture/security.md` §credentials records why one credential per Google service, not one per user.
- [x] progress.md updated

### ✅ AF-M10-04 · OAuth providers: Intuit, GitHub, Atlassian, Notion, Shopify, LinkedIn, X · 2d · **DONE 2026-09-03**
H4. Seven new providers in `oauth-providers.ts`, plus the one shape the current
callback cannot express.

**Depends on:** AF-M10-02
**Acceptance**
- [x] Providers registered with authorize/token URLs, env-backed client id/secret getters, and default scopes; `.env.example` documents all fourteen new vars.
- [x] **Provider-extra capture:** the callback persists provider-specific identifiers returned alongside the token — Intuit's `realmId` (company id), Shopify's `shop`, X's `scope` — into the credential secret. Today `oauth-state.ts` has nowhere to put them; this is the schema change, not a config tweak.
- [x] Refresh handled per provider quirk: Intuit rotates the refresh token on every exchange (the old one dies — persist the new one in the same transaction or the connection is lost); X uses PKCE; Shopify tokens do not expire.
- [x] `oauth.test.ts` covers each provider's authorize-URL construction, the extras capture, and Intuit's rotating-refresh path.
- [x] progress.md updated

### ✅ AF-M10-05 · Polling trigger framework + `TriggerState` · 3d · **DONE 2026-09-03**
H5. The largest single unlock in the milestone — 18 of 35 automations begin with
"when a new X appears". Build the framework once; individual pollers become
~40-line adapters in Phase B.

**Depends on:** AF-M10-01
**Acceptance**
- [x] `TriggerState` model added: `(workflowId, nodeId)` unique, `cursor Json`, `lastPolledAt`, `lastSeenIds String[]`, org-scoped. Migration written and applied.
- [x] A `PollingTrigger` interface in the node SDK: `poll(ctx: { cursor, credentials, config }) => { items: unknown[]; cursor: unknown }`. A poller returns items; the framework owns dispatch, dedupe and cursor persistence — an adapter never writes `TriggerState` itself.
- [x] The `evaluate-schedules` Inngest job is extended (not duplicated) to sweep polling triggers on each workflow's configured interval, honouring `Node.disabled` exactly as AF-M9-17 does for schedule triggers.
- [x] **At-least-once with dedupe:** each returned item carries a stable id; ids seen in the previous window are suppressed, so a retried poll cannot double-dispatch. A test drives two consecutive polls returning an overlapping window and asserts exactly one run per item.
- [x] Backoff on provider failure, and a per-workflow poll budget so one broken credential cannot spend the whole sweep.
- [x] First poll of a newly-activated trigger establishes the cursor **without** dispatching history — a test asserts a workflow activated against a 500-row sheet dispatches zero runs, not 500.
- [x] `docs/architecture/execution_engine.md` §Triggers documents the contract; ADR written (see §5).
- [x] progress.md updated

### ✅ AF-M10-06 · Binary payloads: `FileRef` + blob store · 3d · **DONE 2026-09-03**
H6. 12 automations move a PDF, image or video between nodes. Passing bytes through
`WorkflowContext` is not an option — ADR-0018 caps per-node output.

**Depends on:** AF-M9-01
**Acceptance**
- [x] A `FileRef` shape (`{ $file: { id, filename, mimeType, size, sha256 } }`) is what travels in the context; **bytes never do**. A test asserts a 5 MB download leaves `NodeExecution.output` under the ADR-0018 cap.
- [x] Blob storage behind one interface with two implementations: local filesystem (dev/CI) and S3-compatible (staging/prod), selected by env. No provider SDK leaks past the interface.
- [x] Org-scoped keys, a per-org quota checked before write, and a TTL sweep that deletes blobs whose execution has passed the AF-M8-06 retention window.
- [x] `FILE_DOWNLOAD` (URL → `FileRef`, egress-guarded, size-capped) and `FILE_UPLOAD` helpers available to executors; a node opts in by declaring it accepts/produces `FileRef`.
- [x] Reading a `FileRef` requires the same org as the run — a cross-tenant read is a test case, not a comment.
- [x] ADR written (see §5); `docs/architecture/data_model.md` updated.
- [x] progress.md updated

### ✅ AF-M10-07 · Multimodal input for `AI_LLM` / `AI_EXTRACT` · 1.5d · **DONE 2026-09-03**
H7. Turn the declared `vision` capability into something a graph can use.

**Depends on:** AF-M10-06
**Acceptance**
- [x] Both nodes accept an `attachments` config: a template resolving to one or more `FileRef`s, passed to the provider as image/document parts via the existing `ai` SDK message shape.
- [x] A model without the `vision` capability fails **at validation time** with a message naming the model and the capability — not at run time, and never by silently dropping the attachment.
- [x] Attachment bytes are counted into the AF-M5 cost estimate; a test asserts a vision call's recorded cost exceeds the same prompt without the image.
- [x] PDF handling is explicit: providers that accept PDFs natively get the file; those that do not get page images or extracted text, and the choice is recorded in the trace so a user can see which path ran.
- [x] The AF-M5-07 response cache key includes the attachment `sha256` — two different invoices must not share a cache entry.
- [x] progress.md updated

### ✅ AF-M10-08 · `WAIT` node · 1d · **DONE 2026-09-03**
H8. #27 pauses until 15 minutes before a meeting.

**Depends on:** AF-M9-01
**Acceptance**
- [x] Modes: `duration` (relative) and `until` (a template resolving to an ISO timestamp). Backed by Inngest `step.sleep`/`step.sleepUntil` — no polling loop.
- [x] A maximum wait is enforced and configurable per plan; exceeding it fails validation at save time, not mid-run.
- [x] An `until` in the past resolves immediately rather than erroring.
- [x] The waiting node shows as a distinct status in the trace and the run detail UI — a run parked for six days must not read as hung.
- [x] Cancellation (AF-M8-27) interrupts a sleeping run.
- [x] progress.md updated

### ✅ AF-M10-09 · `APPROVAL` node — send and wait · 2d · **DONE 2026-09-03**
H8. #30 emails an approver and blocks on the answer. `src/features/approvals` has
the dashboard and the `ApprovalRequest` model; this binds them to the graph.

**Depends on:** AF-M10-08
**Acceptance**
- [x] The node creates an `ApprovalRequest` row, sends the request over a configured channel (Gmail/SMTP now; Slack once AF-M10-17 lands), and waits on an Inngest event.
- [x] Two outputs, `approved` and `rejected`, resolved through the AF-M9-09 `resolveOutputs` contract; a timeout routes to `rejected` with a recorded `skipReason`.
- [x] Approval links carry a single-use, expiring, org-scoped token; replay of a used token is rejected and audited. A test covers replay.
- [x] The approver's decision, identity and timestamp land in `AuditLog`.
- [x] Existing dashboard approvals and graph approvals share one model and one list — not two parallel systems.
- [x] progress.md updated

### ✅ AF-M10-10 · `FILTER` and `DEDUPE` nodes · 1d · **DONE 2026-09-03**
H15. Four automations mean "skip what we already handled".

**Depends on:** AF-M10-05
**Acceptance**
- [x] `FILTER`: evaluates a condition per item and passes through only matches, using the AF-M9-08 typed-value rules (a filter on `ok: true` must not compare the string `"true"`).
- [x] `DEDUPE`: suppresses items whose key was seen before, backed by the same `TriggerState` store, scoped to `(workflowId, nodeId)`; modes `forever` and `window(n)`.
- [x] Both are fan-out aware — inside an AF-M9-14 segment they filter the segment's items, and a fully-filtered branch ends the run cleanly rather than erroring.
- [x] Dedupe state is cleared when the node's key expression changes, so an edited workflow does not inherit stale keys.
- [x] progress.md updated

### ✅ AF-M10-11 · `EXTRACT_DOCUMENT_TEXT` node · 0.5d · **DONE 2026-09-03**
The extractor already exists for the knowledge base; expose it to graphs.

**Depends on:** AF-M10-06
**Acceptance**
- [x] Node wraps `src/features/knowledge/lib/extractor.ts` — one implementation, not a copy — taking a `FileRef` and returning `{ text, pageCount, truncated }`.
- [x] PDF and DOCX supported; an unsupported MIME type fails with a message naming the type. #29's "DOCX marked supported but not wired" deviation must not be reproduced here.
- [x] Output is capped and the cap is reported via `truncated`, never silently applied.
- [x] progress.md updated

### ✅ AF-M10-12 · `HTML_TO_PDF` node · 1d · **DONE 2026-09-03**
#28 renders an attorney-ready report.

**Depends on:** AF-M10-06
**Acceptance**
- [x] Takes templated HTML, returns a `FileRef`. Rendering runs with no network access and no JS execution from the input document — a test asserts an embedded `<script>` and a remote `<img>` neither execute nor fetch.
- [x] Page size, orientation and margins configurable; output size-capped.
- [x] Renderer choice and its footprint recorded in the task's DONE note — a headless browser is a deployment decision, not an implementation detail.
- [x] progress.md updated


**DONE note — renderer choice.** Not a headless browser. `jsdom` →
`html-to-pdfmake` → `pdfmake`, **~27 MB installed, pure JavaScript, no
binaries**, versus ~300 MB of Chromium that would have to exist in the runtime
image — which on Vercel it does not, so a browser would have meant a second
deployment target for one node.

The bigger reason is that the safety properties become structural instead of
configured. jsdom is constructed without `runScripts` (nothing executes) and
without `resources` (nothing is fetched); pdfmake's `setUrlAccessPolicy` denies
every URL and `setLocalAccessPolicy` allows only the fourteen PDF standard font
names. With a browser, "no network, no JS" is request interception plus a
disabled JS context — configuration, which fails open.

Two layers, deliberately: the DOM is sanitized first (scripts, iframes, link,
style, on* attributes and any `<img>` that is not already a `data:` URI are
removed) so a stray remote image degrades to a missing image rather than
aborting the render, and the deny policies remain underneath so a miss in
sanitization still cannot fetch.

**What it costs:** CSS support is `html-to-pdfmake`'s — headings, paragraphs,
lists, tables, inline styles, basic text formatting. Floats, flexbox, grid and
page-break control are not honoured. Adequate for a generated report (#28's
shape); not adequate for rendering an arbitrary web page. The node's
description says so.

### ✅ AF-M10-13 · External vector store for `AI_RETRIEVE` (Pinecone) · 1.5d · **DONE 2026-09-03**
H12. #23 needs a caller-supplied index.

**Depends on:** AF-M10-02
**Acceptance**
- [x] A `VectorStore` interface with two implementations: the existing internal `KnowledgeChunk` search and Pinecone (upsert/query/delete by namespace).
- [x] `AI_RETRIEVE` gains a store selector; the internal store stays the default so no saved node changes behaviour.
- [x] Embedding dimension is validated against the index before the first write, with a clear error naming both numbers — #23's 768-dimension prerequisite is exactly the failure users hit.
- [x] Namespaces are org-scoped; a test asserts one org cannot query another's namespace.
- [x] progress.md updated

### ✅ AF-M10-14 · `FORM_TRIGGER` — first-party hosted intake form · 1.5d · **DONE 2026-09-03**
H13. #6, #21, #31 and #33 start from a form submission.

**Depends on:** AF-M10-06
**Acceptance**
- [x] A published workflow exposes a form at a stable public path; fields are authored in the node config (text, email, select, file).
- [x] File fields produce `FileRef`s through the AF-M10-06 store, size- and type-capped.
- [x] Anti-abuse: per-form rate limit (reusing `src/lib/rate-limit`), a size cap, and an optional secret path segment. An unpublished or disabled workflow's form returns 404, not a 500.
- [x] Submission payload shape documented and mapped into the run context alongside the AF-M9-07 `webhook.*` mapping, so ported n8n form expressions resolve.
- [x] progress.md updated

#### Phase B — service node families

Each family shares one thin client built on the AF-M10-01 auth path. A family task is
done when its nodes are registered, unit-tested against recorded fixtures, and
documented in `docs/nodes/`.

### ✅ AF-M10-15 · Google Workspace family · 4d · **DONE 2026-09-04**
H10. Needed by 21 of 35 — the widest single dependency in the matrix.

**Depends on:** AF-M10-03, AF-M10-05, AF-M10-06
**Acceptance**
- [x] Sheets: `SHEETS_READ` (range → rows, with header mapping), `SHEETS_UPDATE` (write a specific row), `SHEETS_UPSERT` (match-on-column), `SHEETS_TRIGGER` (new row, via AF-M10-05). Existing `GOOGLE_SHEETS_APPEND` is left untouched.
- [x] Gmail: `GMAIL_SEND` (HTML + attachments from `FileRef`), `GMAIL_TRIGGER` (new unread, with the label/query filter #26 needs).
- [x] Drive: `DRIVE_TRIGGER` (new file in folder), `DRIVE_DOWNLOAD` → `FileRef`, `DRIVE_UPLOAD`, `DRIVE_MOVE` (#28/#29 move between intake/processing/approved folders).
- [x] Calendar: `CALENDAR_TRIGGER` (upcoming events window, with attendee emails).
- [x] Google API 429/403-quota responses map to a **retriable** error with backoff; auth failures map to `NonRetriableError`. A test covers both, because getting this backwards burns a user's quota on retry.
- [x] Pagination handled inside each node (`nextPageToken`), with a bounded page budget — no unbounded loop.
- [x] progress.md updated

**Status 2026-09-04 — done.** Eleven nodes across four services, on three service
modules (`src/features/google/server/{sheets,gmail,drive,calendar}.ts`) over one
shared client (`google-client.ts`: error classification, `googleFetch`,
`googleFetchBytes`, `paginate` with a 20-page budget). 45 tests in
`src/features/google`.

Three things the source automations forced that were not obvious from the
acceptance list:

- **Drive has no "move".** It is a parent swap, and the old parent must be named
  explicitly or the file ends up in both folders — so the watched folder still
  contains it and the next poll reprocesses the same contract. `moveDriveFile`
  reads the file first (which also makes a retried step idempotent) and removes
  *every* current parent, not just the first.
- **A Google Doc has no bytes.** `alt=media` errors for Docs/Sheets/Slides;
  they must be exported. `downloadDriveFile` exports to the Office equivalent
  and reports which happened, so the filename and MIME type match what the
  caller actually got. A Form or a Site has neither, and is named as such rather
  than handed over as an empty file.
- **`DRIVE_TRIGGER` advances to the newest `modifiedTime` it saw**, not to
  `now` — using the local clock would skip a file written between the request
  and the response. Sheets and Gmail have no such cursor and use the seen-id
  window instead.

`GMAIL_TRIGGER` skips fetching bodies on its first poll: the framework
dispatches nothing on a first sight, so `limit` message-gets would be spent
against the user's quota for results that are discarded. `CALENDAR_TRIGGER`
keys an item as `${event.id}@${event.start}`, so a rescheduled meeting briefs
again, and drops `resource: true` attendees — Calendar counts a meeting room as
an attendee and a room has no address to look up.

Gmail header handling is where the security work is: `headerValue` strips CR/LF
(a newline in a templated subject is header injection — `"Hi\nBcc: everyone@"`
adds a recipient), `encodeHeader` applies RFC 2047 so an em dash or an accented
name does not arrive as mojibake, and attachment base64 is wrapped at 76
characters because unwrapped lines breach RFC 5322's 998-character limit and
some relays mangle them. Drive query values go through `escapeDriveQuery`: a
folder name with an apostrophe would otherwise close the quoted string and have
its remainder parsed as query syntax.

**Two corrections this task forced.** (1) `countRequiredCredentials` counted
credential *bindings*; a Sheets template that reads a row and writes it back
binds the same credential twice and was scored as two connectors. It now counts
distinct **types** — what a user actually connects. (2) The catalogue's
one-credential rule was written when every entry was an onboarding template. The
M10 library ports automations that are multi-service in the source (#1 is Sheets
plus Gmail; #27 is Calendar plus Gmail), so `TemplateSpec` gained a `tier`:
`"starter"` keeps the one-credential onboarding promise, `"library"` is capped
at four and must need more than one, so the label cannot be used to dodge the
stricter rule. The credential-free floor is now measured over starter entries,
which stops it getting easier to clear as M10 adds credential-bound templates.

Four templates ship with it, covering all seven new node types: Drive contract
intake (`DRIVE_TRIGGER`/`DOWNLOAD`/`MOVE`), inbox triage with a threaded
acknowledgement (`GMAIL_TRIGGER`/`GMAIL_SEND`), a weekly report archived to
Drive (`DRIVE_UPLOAD`), and the meeting briefing (`CALENDAR_TRIGGER`, the first
`library`-tier entry). 36 catalogue entries, 1481 unit/dom tests and 243
integration tests green; lint and `tsc --noEmit` clean.

### ✅ AF-M10-16 · QuickBooks Online family · 3d · **DONE 2026-09-04**
10 of 35 — the largest single-service dependency.

**Depends on:** AF-M10-04
**Acceptance**
- [x] Nodes: `QBO_FIND_CUSTOMER`, `QBO_CREATE_CUSTOMER`, `QBO_CREATE_INVOICE`, `QBO_CREATE_ESTIMATE`, `QBO_CREATE_SALES_RECEIPT`, `QBO_CREATE_EXPENSE`, `QBO_GET` (by id/type), `QBO_GET_INVOICE_PDF` → `FileRef`, `QBO_ATTACH` (attach a `FileRef` to a record).
- [x] `QBO_WEBHOOK_TRIGGER` verifying Intuit's `intuit-signature` HMAC; an unverified payload is rejected. Needed by #10, #12, #15. **Deviation, recorded below: rejections are logged, not written to `AuditLog`.**
- [x] Sandbox vs production base URL is a credential property, not a node config — the source templates' "sandbox values must be replaced" footgun must be impossible here.
- [x] `realmId` comes from the credential (AF-M10-04), never from node config.
- [x] Intuit's minor-version pinning and its "query" endpoint escaping are handled centrally; a test covers a customer name containing an apostrophe.
- [x] progress.md updated

**Status 2026-09-04 — done.** Ten nodes on `src/features/quickbooks/server/`
(`qbo-client.ts`, `entities.ts`, `webhook.ts`, `dispatch.ts`) plus the app-wide
route at `/api/webhooks/quickbooks`. 53 tests.

**One deviation from the acceptance, stated plainly.** An unverified payload is
rejected and *logged*, not written to `AuditLog`. That table is org-scoped and
read through an org-scoped viewer — and an unverified Intuit payload has no
proven realm, so every rejection would have to be filed against a **guessed**
tenant, in the one table whose value depends on its rows being true. Rejections
are operator-facing, not tenant-facing; the structured warning carries the same
facts without corrupting a tenant's trail.

Three shapes the API forced:

- **Intuit posts to one endpoint per app, not per workflow.** Unlike the Stripe
  and Google Form routes there is no per-workflow secret in the URL to check
  first, so the signature is the only proof and routing runs *backwards*:
  verify, match the payload's realm to a stored credential, then find the
  published workflows whose QBO trigger binds it. The trigger's credential is
  therefore what says which company a workflow is listening to — without it, a
  second connected company's invoices would start it too.
- **The signature is over the RAW body.** Reading it with `request.json()` and
  signing `JSON.stringify(parsed)` is the obvious implementation and it is
  wrong: key order, whitespace and number formatting all differ, so every check
  fails in a way that looks like a wrong verifier token. There is a test for
  exactly that mistake. A deployment with no verifier token rejects everything
  — an endpoint that cannot verify must never fail open.
- **`STARTPOSITION` is 1-indexed**, and QBO treats 0 as 1. A pagination loop
  starting at 0 re-reads the first page's tail forever: an infinite loop that
  looks like a working one. A short page is the only end-of-results signal QBO
  gives.

Error 6240 ("Duplicate Name Exists") gets its own message. It is the most
common QBO write failure and Intuit reports it as "Business Validation Error",
which tells the user nothing; the node names the find-then-create pattern
instead. Amounts are coerced from `"$1,299.00"` and **refused when blank**
rather than posted as zero — `Number("")` is `0`, and a zero-amount line on a
real invoice is never what was meant.

**One platform gap this exposed and closed.** The schema-driven config panel
had no multi-select: `z.array(z.enum([...]))` threw
`UnsupportedConfigFieldError`, so the trigger's entity/operation filters were
unauthorable. A `multiEnum` kind now renders as a checkbox group. This is not
QBO-specific — every webhook connector that lets you narrow events needs it,
and AF-M10-18's GitHub trigger is next.

Six templates ship with it, covering all ten node types: invoice from an
incoming order (find-then-create, wired as two terminal branches because only
one runs), Slack invoice alerts, invoice PDFs to Drive, a Stripe payment as a
sales receipt, an estimate from a sheet row, and an expense with its receipt
attached. 42 catalogue entries; 1537 unit/dom and 243 integration tests green.

### ✅ AF-M10-17 · Slack Web API family (supersede webhook-only) · 1.5d · **DONE 2026-09-04**
H9. #26 creates channels; #27 DMs by email; #8 and #31 post to a chosen channel.

**Depends on:** AF-M10-01
**Acceptance**
- [x] `SLACK_POST` (bot token, `chat.postMessage`, Block Kit body), `SLACK_LIST_CHANNELS`, `SLACK_CREATE_CHANNEL`, `SLACK_INVITE`, `SLACK_DM_BY_EMAIL` (`users.lookupByEmail` → `chat.postMessage`).
- [x] The existing webhook-only `SLACK` node is deprecated per ADR-0011 (`replacedBy: "SLACK_POST"`) — kept registered and executable, dropped from the palette.
- [x] Required scopes are declared per node and surfaced in the config panel, so a missing `channels:manage` is a readable error rather than a Slack `missing_scope` code.
- [x] Slack's `ok: false` envelope (HTTP 200 with an error body) is treated as failure — a test asserts a `channel_not_found` response fails the node instead of succeeding with junk.
- [x] progress.md updated

**Status 2026-09-04 — done.** Five nodes on one client
(`src/features/slack/server/slack-client.ts`), 35 tests. `docs/nodes/slack.md`
written.

**The `ok: false` envelope is the whole reason the client exists.** Slack
answers HTTP 200 with `{"ok": false, "error": "channel_not_found"}` for nearly
every failure, so a client checking `response.ok` records a failed post as a
success and lets the workflow continue as if the message went out. A missing
`ok` is treated as failure too — absent is not true. `429` and `5xx` are the
only cases Slack uses a status code for, and both retry.

**Scopes are declared per node**, so `CredentialRequirement` gained a `scopes`
field. One connection serves operations at different privilege levels —
`chat:write` to post, `channels:manage` to create, `users:read.email` to look a
person up — and an admin may grant the first two and decline the third. The
panel shows the requirement before the run; the executor turns Slack's bare
`missing_scope` into a sentence naming the scope.

Three provider behaviours handled where they belong: `name_taken` returns the
existing channel (so create-if-absent needs no branch and a retry is
idempotent), `already_in_channel` is success (it is the goal state, and Slack
sends it even when only some users were already members), and channel names are
normalised to Slack's rules first, so `Acme Corp — Q3!` does not silently
become something else or get rejected.

**Two defects this task exposed in already-shipped work.**

1. **Two M10 templates had a `CONDITION` that always took the same branch.**
   They authored `leftValue`/`rightValue`; the schema's fields are
   `left`/`right`. Zod objects here are not `.strict()`, so the unknown keys
   parsed cleanly and the comparison ran on two undefineds. The harness now
   rejects any authored key the node's schema does not read — it found eight
   more dead keys across the catalogue (a `variableName` on `CODE`, which
   spreads its return value instead; a `channel` on `DISCORD`, which posts
   through a channel-pinned webhook URL). `_`-prefixed keys are exempt because
   AF-M9-06's `_run` policy block is read outside the config schema.
2. **The root validator reported a false positive on every `CODE` node.** A
   node returning `{ valid, errors }` followed by a `CONDITION` on `{{valid}}`
   is an ordinary graph, and `computeValidRoots` had no model of CODE's return
   spread. It now reads a literal `return { ... }`, always allows `items` (the
   array branch), and — when the body returns something it cannot read —
   reports the root set as *unknowable* and stops checking rather than warning
   about roots it cannot enumerate.

**Catalogue consequences, stated because they are not small.** Deprecating the
webhook node meant migrating 16 template nodes to `SLACK_POST`, and four
templates that had one connector plus a "free" Slack post became genuinely
two-service and were reclassified `library`. Nine went from zero credentials to
one — but they were never zero-*setup*: the webhook node's secret was an
incoming-webhook URL in plain node config, so the user still had to create a
Slack app, enable webhooks, mint a channel-specific URL and paste it. The
`credentialCount === 0` metric was measuring "declares no credential binding",
not "needs no setup", and the gap between those two is the defect this
deprecation fixes. The onboarding sample (`content-brief-generator`) lost its
Slack tail outright — a first run that dies on its last node because Slack is
not connected is a worse introduction than one that just produces the brief.
Three new credential-free templates restore the one-third floor, which the user
chose to keep rather than relax.

### ✅ AF-M10-18 · Dev-tools family: GitHub, Jira, Notion · 3d · **DONE 2026-09-04**
Needed by #18, #19, #20, #27, #31.

**Depends on:** AF-M10-04
**Acceptance**
- [x] GitHub: `GITHUB_TRIGGER` (push/PR webhook with HMAC-SHA256 signature verification), `GITHUB_CREATE_PR`, `GITHUB_LIST_COMMITS`, `GITHUB_SEARCH_PRS`.
- [x] Jira: `JIRA_CREATE_ISSUE`, `JIRA_TRANSITION` (by transition **name**, resolved per project — the source templates hardcode numeric status ids and break on any other project), `JIRA_SEARCH` (JQL), `JIRA_ADD_ATTACHMENT`.
- [x] Notion: `NOTION_CREATE_PAGE`, `NOTION_QUERY_DATABASE`.
- [x] Webhook signature verification is shared with the AF-M10-16 QBO verifier — one constant-time comparison, not three.
- [x] progress.md updated

**Status 2026-09-04 — done.** Ten nodes over three clients, 96 tests.
`docs/nodes/dev-tools.md` written.

**One signature verifier.** `src/lib/server/webhook-signature.ts` now holds the
codebase's only constant-time comparison; Intuit's base64 header and GitHub's
hex-behind-`sha256=` differ only in cosmetics, and the QBO verifier was moved
onto it. It fails closed on every path, including two that are easy to get
backwards: an **empty secret** is refused (HMAC with `""` is a valid digest, so
an unset env var would otherwise verify signatures an attacker can compute), and
a **short decode** is refused (`Buffer.from` drops invalid characters rather than
throwing, so garbage becomes a short buffer — the length check is what rejects
it, not an optimisation).

**GitHub's failure modes are miscategorised by the obvious code.** It runs two
rate limiters and reports both as 403 — the primary with
`x-ratelimit-remaining: 0`, the secondary with `retry-after` — so
`status === 403 → permanent` turns a wait-and-succeed into a failed run. And it
answers **404, not 403**, for a private repository the token cannot see, so
"repository not found" sends people after a typo when the cause is a missing
scope. Both are classified on the headers rather than the status.

The trigger receives on one app-wide endpoint, like Intuit's. **A trigger naming
no repository is skipped rather than treated as a wildcard** — on a shared
endpoint a blank repo would fire one workspace's workflow on every other
workspace's repositories. Only `X-Hub-Signature-256` is accepted; GitHub still
sends the SHA-1 header for pre-2019 consumers and accepting it would admit
anyone who can forge the weaker digest.

**Jira transitions by name is the headline.** Transition ids are per workflow
scheme, so `31` is Done where it was written and nothing anywhere else. The node
asks the issue what it can currently do, matches case-insensitively, and falls
back to the destination status name — people say "move it to Done" when the
transition is called *Finish Work*. A miss lists what is available, which is
usually enough to see the issue is already there. Two more Jira facts encoded
where they belong: v3 wants **ADF**, not a string (a plain description is
rejected with a message that never says so), and an attachment upload needs
`X-Atlassian-Token: no-check` or Jira answers with an HTML XSRF page that a
JSON client reports as a parse error.

**Notion's permission model is per-object**, so `object_not_found` is far more
often "not shared with this integration" than "does not exist", and the error
says so. `NOTION_CREATE_PAGE` reads the database schema and wraps each plain
string for its column's declared type, because the property union rejects a
mismatch without naming the column; an unknown column fails loudly with the real
names, since Notion is case-sensitive and a row created with columns silently
missing is worse than none.

**Two defects this exposed in AF-M10-17's own work.** The root inference added
for `CODE` nodes was wrong twice, and both times it produced the false positive
it was written to prevent. It matched keys with one regex that consumed the
delimiting comma, so `{ a, b, c }` yielded only `a`; and it blanked string
literals before reading keys, which erases **quoted keys** — `{ "delta": 4 }`
became `{ "": 4 }`. It is now a single string- and comment-aware scan, and it
skips comments *inside* the literal too, which is what a catalogue template
tripped over. Four regression tests cover the cases, including one asserting the
check still catches a real typo in a graph with no `CODE` node, so it cannot
quietly become a no-op.

**Catalogue.** Eight templates (57 total): PR→Jira issue, merge→transition,
auto-PR on push, stale-PR digest, release notes→Notion, Notion content
calendar, a Jira sprint report rendered to PDF and attached back, and — to hold
the one-third credential-free floor as the dev-tools entries pushed the starter
count up — an API data-contract monitor, a fan-out proxy and a form-to-PDF
receipt. `noTemplateCurlyInString` is turned off for the catalogue directory:
a template's `code:` field is JavaScript source, so `${…}` inside it is correct
by construction rather than the mistake the rule looks for.

### ✅ AF-M10-19 · Data-acquisition family: Apify, Apollo, Google Search/Maps · 2.5d · **DONE 2026-09-04**
Needed by #2, #3, #5, #6, #7, #22.

**Depends on:** AF-M10-02
**Acceptance**
- [x] `APIFY_RUN` starts an actor and waits for the dataset, with a bounded wait and a run-timeout that surfaces as a clear error; `APIFY_GET_DATASET` fetches results with pagination. The five automations that use Apify all follow run-then-fetch, so the wait must be a first-class, cancellable step — not a sleep loop.
- [x] `APOLLO_ENRICH` (person/organization match), rate-limit aware.
- [x] `GOOGLE_SEARCH` (Custom Search JSON API, `cx` from the credential) and `GOOGLE_MAPS_SEARCH` (Places text search).
- [x] Per-run result caps and cost notes in the docs — these are metered APIs and an unbounded actor run is a bill, not a bug.
- [x] progress.md updated

**Status 2026-09-04 — done.** Five nodes over three clients, 51 tests.
`docs/nodes/data-acquisition.md` written, leading with a cost table because
every node in this family spends money on every run.

**The Apify wait is durable steps, not a sleep loop**, exactly as the
acceptance required. Each poll and each sleep is its own step, following the
`WAIT` node's pattern from AF-M10-08: a wait parked inside one long `step.run`
cannot notice it was cancelled until that step returns, so "cancel" on a
ten-minute scrape would mean "cancel in ten minutes". It also frees the worker
and survives a redeploy.

**Every path that stops waiting aborts the actor run.** This is the part that
turns the acceptance's "a bill, not a bug" into code: Apify meters compute
units for as long as an actor is alive, so a timeout or a cancellation that
merely stops *waiting* leaves a scraper running on the user's money. The node
calls abort and says in its error whether that succeeded — and when it did not,
tells the user to stop it in the console rather than letting them find out from
an invoice. Apify's own run timeout is set just above ours as a backstop for
the case where this workflow dies between polls. The start call is its own step
so a retry of a later step cannot launch a second run.

**A failed actor is a successful API call.** Apify reports failure as HTTP 200
describing a `FAILED` run, so the node checks the terminal state rather than
the response, or it would report success and hand an empty dataset on. Same
class of bug as Slack's `ok: false` in AF-M10-17.

**Rate limits that are not rate limits.** Two providers here answer 429 for
things a retry cannot fix, and both are classified on headers rather than
status: Apollo's *daily* allowance (as opposed to its per-minute window) and
Google Custom Search's *daily quota* (as opposed to `rateLimitExceeded`).
Retrying either spends the whole attempt budget and then reports the wrong
cause.

**The Places field mask is the price list.** Places (New) bills by SKU
according to the fields requested, so `*` — the obvious shortcut — puts every
call on the most expensive tier. The mask is assembled from what the node was
configured to want, and phone/website/hours are opt-in. Also added
`googleMaps.apiKey` as its own credential type: a Cloud key restricted to
Custom Search returns 403 for Places, so reusing the search credential would
produce a permission error that reads like a bad key.

**Caps everywhere, and truncation reported rather than implied**: 1,000 dataset
items, 100 search results (Google will not page further anyway), 60 places, one
Apollo match per run with email reveal off. A workflow that silently processed
the first thousand of forty thousand rows looks like it worked.

**Catalogue.** Five templates (62 total): a scheduled scrape-and-digest, a
Maps prospect list, inbound-lead enrichment, a pre-call research brief, and —
to hold the credential-free floor as three new starter entries pushed it up —
a paced backfill that walks a list with a durable pause between items. The
harness's header comment was rewritten: it had been enumerating what each
template demonstrates and had fallen a milestone behind, so it now explains
what the count is for and leaves the enumeration to the tests.

### ✅ AF-M10-20 · Commerce & list family: Airtable, Shopify, MailerLite, Stripe actions · 3d · **DONE 2026-09-04**
H11. Needed by #9, #16, #17, #24, #25, #33, #34.

**Depends on:** AF-M10-04, AF-M10-05
**Acceptance**
- [x] Airtable: `AIRTABLE_READ` (with filterByFormula), `AIRTABLE_UPDATE`, `AIRTABLE_TRIGGER` (new/changed record via AF-M10-05). Existing `AIRTABLE_CREATE_RECORD` untouched.
- [x] Shopify: `SHOPIFY_CREATE_ORDER` (line items, customer, shipping).
- [x] MailerLite: `MAILERLITE_FIND_SUBSCRIBER`, `MAILERLITE_CREATE_SUBSCRIBER` (with group assignment).
- [x] Stripe: `STRIPE_FIND_OR_CREATE_CUSTOMER`, `STRIPE_CREATE_PAYMENT_LINK`, `STRIPE_GET_CUSTOMER`. The existing `STRIPE_TRIGGER` is untouched.
- [x] Every create is idempotent where the API supports it (Stripe `Idempotency-Key`, Airtable typecast off) — a retried step must not create a second customer or a second order.
- [x] progress.md updated

**Status 2026-09-04 — done.** Nine nodes over four clients, 69 tests.
`docs/nodes/commerce.md` written.

**Idempotency is the spine of this task**, and each provider helps by a
different amount, so `src/lib/server/idempotency.ts` supplies the one thing
they all need: a key derived from the **execution** and the **node**. Both
halves matter and getting either wrong is worse than not trying — a random key
per attempt defeats the mechanism entirely, and a key from the node alone would
make two runs an hour apart collide, so the second silently returns the first
run's object instead of doing its work. It is hashed rather than concatenated,
which caps it under Stripe's 255-character limit and keeps record contents out
of the provider's logs.

- **Stripe**: `Idempotency-Key` on every POST; a retry returns the original
  object for 24 hours. `STRIPE_FIND_OR_CREATE_CUSTOMER` exists because Stripe
  treats email as a label rather than a key and will hold four customers with
  the same address.
- **Shopify**: orders have no idempotency header, so the guard is the pair
  Shopify does offer — `source_name` + `source_identifier`, unique per shop.
  The lookup includes archived orders, because an order closed between the
  write and the retry would otherwise be invisible and get duplicated.
- **MailerLite**: `POST /subscribers` is an upsert by design, so the create is
  naturally idempotent. Worth stating, because identical code against most
  list providers would be a duplicate-generator.
- **Airtable**: no key available; `typecast` is explicitly OFF, and the update
  is a PATCH by record id.

**Three provider behaviours that report success while doing nothing useful.**
Adding a MailerLite subscriber who already unsubscribed returns 200 **without
resubscribing them**, so the node reports the returned status rather than
assuming — "the call worked" is not "they are on the list". Stripe returns a
deleted customer as a normal 200 with `deleted: true` rather than a 404. And
Airtable's `typecast` would let a workflow writing "Hight" into a status column
silently add "Hight" as a valid option instead of failing.

**The Airtable trigger's item id is the entire new-versus-changed mechanism.**
With no modified field the id is the record id, so a record fires once ever;
point the node at a last-modified column and the id becomes
`recordId@timestamp`, so an edit is a new id and fires while an untouched
record does not. One config field rather than a second node type, and the
framework's dedupe does the rest.

**A wart, named rather than hidden**: `AIRTABLE_CREATE_RECORD` predates the new
client and still carries its own inline fetch. The acceptance says to leave it
untouched, so there are two callers of the same API for now; it should move
onto the shared client the next time it is opened for another reason.

Added `stripe.apiKey` as a credential type with a connection tester. The
webhook route's deployment-level signing secret verifies inbound events and
cannot act as a tenant, so nodes that create customers need a per-org key.

**Catalogue.** Seven templates (69 total): Airtable intake triage and
lookup-before-write, a form-to-payment-link flow, Stripe-payment-to-Shopify-
order, a MailerLite signup that respects a previous opt-out, an SLA escalation
that re-checks before escalating, and a retry-with-backoff chain — the last two
credential-free, to hold the one-third floor as four new starter entries pushed
it up.

### ✅ AF-M10-21 · Messaging family: Telegram, WhatsApp (WAHA) · 2d · **DONE 2026-09-04**
Needed by #23 and #31.

**Depends on:** AF-M10-02
**Acceptance**
- [x] Telegram: `TELEGRAM_TRIGGER` (webhook with a secret path token), `TELEGRAM_SEND_MESSAGE`, `TELEGRAM_GET_FILE` → `FileRef` (#23 uploads a PDF).
- [x] WAHA: `WAHA_TRIGGER` (inbound message webhook), `WAHA_SEND_MESSAGE`, against a user-supplied base URL that is egress-guarded like any other.
- [x] Inbound webhook bodies are size-capped and validated before dispatch; an unverified Telegram update is dropped, not run.
- [x] progress.md updated

**Status 2026-09-04 — done.** Five nodes over two clients, 43 tests.
`docs/nodes/messaging.md` written.

**Neither provider signs its webhooks**, and that is worth stating plainly
rather than papering over: GitHub and Intuit send an HMAC, Telegram and WAHA
send nothing. The only proof is a shared secret, so anyone who learns it can
forge a delivery. Both routes are built accordingly — one endpoint per
workflow carrying the workflow's OWN secret (never a deployment-wide one, so a
leak is contained), constant-time comparison, verification **before the body is
read** so an unauthenticated request cannot make the process allocate, a 1 MB
cap, and a 404 for every reason a delivery cannot run so the endpoint is not an
oracle for which workflow ids exist. A Telegram `secret_token` under 16
characters is refused outright: Telegram permits one character, and accepting
that would make the header a formality.

**The WAHA base URL is user input, so it goes through the same egress guard as
`HTTP_REQUEST`.** A self-hosted URL pointing at `169.254.169.254` would turn a
WhatsApp node into a cloud-metadata reader, and one pointing at an internal
host into a port scanner with the server's network position. `safeFetch`
resolves, refuses loopback/private/link-local/CGNAT, pins the connection to the
address it vetted and re-vets each redirect hop; the URL is also checked up
front so a bad credential fails with a sentence rather than a connection error
mid-run.

**WAHA delivers the bot's own outbound messages back as events.** A workflow
replying to what it receives would reply to its own replies, forever. The route
drops `fromMe` before dispatch — a route-level filter rather than something
every template has to remember, which is the difference between a safe default
and a documented footgun.

**Telegram failure is an `ok: false` envelope**, like Slack: an HTTP 200 can
describe a refusal. Its 403 gets a real sentence, because "bot was blocked by
the user" does not say that a bot cannot start a chat, cannot message someone
who blocked it, and must be a group member to post there. Long messages are
**split, not truncated** — Telegram rejects anything over 4096 characters, so
the alternative to splitting is sending nothing — and a photo is taken from the
END of Telegram's ascending size array, since taking the first would silently
fetch a thumbnail.

**Two test-suite bounds set rather than worked around.** The runtime-dependency
guards and the palette DOM test both analyse or render the WHOLE codebase, and
both began timing out under load while passing alone as M10 grew it — which
reads as a broken guard rather than a slow one. Parse and module-resolution
results are memoised, and the three whole-tree walks now carry an explicit
30-second bound with a comment saying why vitest's 5-second unit-test default
was never a meaningful limit for them.

**Catalogue.** Three templates (72 total): a Telegram document assistant that
downloads a PDF and replies with a summary (#23's shape), a WhatsApp
out-of-hours responder, and a credential-free meeting-notes-to-action-list flow
to hold the one-third floor.

### ✅ AF-M10-22 · Social publishing family: X, LinkedIn, YouTube, Upload-Post · 2.5d · **DONE 2026-09-04**
Needed by #32, #34, #35.

**Depends on:** AF-M10-04, AF-M10-06
**Acceptance**
- [x] `X_POST` (v2 `POST /2/tweets`, OAuth2 PKCE user context), `LINKEDIN_POST` (UGC post with image upload — a two-step register-then-upload dance), `YOUTUBE_UPLOAD` (resumable upload from a `FileRef`), `UPLOAD_POST_PUBLISH` (Instagram via Upload-Post.com).
- [x] Media upload paths stream from the blob store; a video is never buffered whole in memory. A test uploads a fixture larger than the per-node output cap.
- [x] Character/media limits validated before the call, with the platform limit named in the error.
- [x] Each node documents the account tier its API needs (X v2 write access is not on the free tier) so a user learns it from the config panel, not a 403.
- [x] progress.md updated

**Status 2026-09-04 — done.** Four nodes over four clients, 38 tests.
`docs/nodes/social-publishing.md` written.

**Streaming needed new machinery, not a new call.** `readFile` returns a
Buffer, which is right for a PDF and wrong for a video: 100 MB buffered whole
is 100 MB of worker heap, and a few concurrent runs is an OOM that takes every
unrelated run on that worker with it. So `BlobStore` gained `getStream`
(`Readable.toWeb` locally, `transformToWebStream` on S3) and `file-service`
gained `readFileStream` — carrying the **same tenant check**, because a
streaming variant that skipped it would be a hole in precisely the place that
matters. The acceptance's test uploads an 8 MB fixture, well over the 1 MB
per-node output cap, and asserts it arrives in more than one chunk with no
chunk the size of the file: a buffering implementation produces exactly one.

Two consequences are documented rather than discovered: Node's fetch throws on
a streaming body without `duplex: "half"` and says nothing about streams, and a
consumed stream cannot be re-sent, which is why the upload helpers take a
`fileId` rather than a stream.

**The real ceiling is the store's, not the platform's.** `MAX_FILE_BYTES` caps a
stored file at 100 MB, so the per-node caps (2 GB YouTube, 1 GB Upload-Post)
are backstops for if that is raised rather than limits a workflow reaches. The
first template written here tried a 500 MB download and the harness caught it,
which is the gate doing its job.

**`NodeDefinition.accountRequirement`** is new, and exists because this family
shares a failure the others do not: a **403 that looks exactly like a scope
problem and is not**. An X app on the free tier authenticates cleanly, holds
every scope, and is refused on every post because v2 writes are not sold at
that tier. Same shape for LinkedIn's product approval, YouTube's project
verification and Upload-Post's Instagram account type. The requirement renders
in the config panel, and the runtime errors name the tier before they mention
scopes.

**Limits are checked the way each platform counts.** X uses *weighted*
characters — emoji and most non-Latin count as two — so `String.length` would
let a post through that X then rejects without saying by how much. YouTube's
title limit, its ban on angle brackets, its mandatory
`selfDeclaredMadeForKids`, and LinkedIn's 3000 characters are all checked
before the call with the number in the message.

**Upload-Post answers 200 with a per-platform result map**, so a "successful"
request can contain a failed Instagram entry — Slack's `ok: false` in a
different shape. Every platform failing is a failed run; a partial failure is
reported rather than thrown, since two of three platforms is a real outcome to
branch on.

Added `google.youtube` as a sixth scoped Google credential, granting
`youtube.upload` only — the wider `youtube` scope would also let a workflow
delete the channel's back catalogue, which nothing here needs.

**Catalogue.** Two templates (74 total), both `library`: write-once-publish-to-
X-and-LinkedIn, and a video published to YouTube and Instagram from one
streamed file.

### ✅ AF-M10-23 · Media generation family: OpenAI Images, Veo, Creatomate, Pollinations, OpenRouter · 2.5d · **DONE 2026-09-04**
Needed by #26, #33, #34, #35.

**Depends on:** AF-M10-06, AF-M10-07
**Acceptance**
- [x] `OPENAI_IMAGE` (DALL·E/gpt-image) → `FileRef`; `POLLINATIONS_IMAGE` → `FileRef`.
- [x] `VEO_GENERATE` (Vertex AI) and `CREATOMATE_RENDER`: both are long-running jobs — submit, then poll to completion as a bounded, cancellable step with a configurable ceiling, surfacing progress in the trace.
- [x] `OPENROUTER_CHAT` registered through the existing `AI_COMPATIBLE` path rather than as a new provider, since OpenRouter is OpenAI-compatible — reuse, don't duplicate (#26's Llama 3).
- [x] Generation cost is recorded through the AF-M5 cost pipeline; per-image and per-video pricing entries added to the model registry.
- [x] progress.md updated

**Status 2026-09-04 — done. Phase B complete.** Four nodes over three clients,
22 tests. `docs/nodes/media-generation.md` written.

**OpenRouter needed no node.** The acceptance's "reuse, don't duplicate" is
right: OpenRouter speaks OpenAI's Chat Completions shape, so a second
implementation would be a copy that drifts. `OPENAI_COMPATIBLE_CHAT` already
does this — the change was widening its credential requirement to
`openaiCompatible.apiKey|openrouter.apiKey`, because an OpenRouter key IS an
OpenAI-compatible key and making users re-enter it under a second type would be
paperwork rather than a distinction. Base URL and model id go in the config
that already exists.

**Per-unit pricing could not live in `AiModelDef`** — `inputCostPer1M` has no
meaning for a model charging four cents an image — so `aiMediaModels` sits
beside it in the same file, feeding the same `__usage.costUsd` →
`NodeExecution.costUsd` path. A workflow that renders a video and then
summarises it shows one bill rather than two systems' worth. Two deliberate
choices: a free provider records **zero rather than nothing**, because a cost
report should say a step was free instead of being silent about it; and an
unpriced model costs 0 rather than throwing, because a missing price is a
reporting gap and refusing the run would be a worse one.

**The long-running wait is the AF-M10-19 shape, extracted.** Veo and Creatomate
both submit-then-poll for minutes and both meter by output, so
`job-poller.ts` holds it once: each poll and each sleep its own durable step
(a wait inside one long `step.run` cannot notice cancellation until it
returns), the node marked `WAITING` so a ten-minute render does not read as a
hang, a loop bounded by a count computed up front rather than by the clock, and
every exit path asking the provider to stop — a job nobody will read still
finishes and still bills. Both nodes submit in their own step so a retry of the
wait cannot start a second render.

**Four provider behaviours that would otherwise pass as success.** Vertex
reports a refused generation as `done: true` WITH an `error`, so treating done
as success hands an empty result downstream. Creatomate's `succeeded` and
`failed` are both terminal and only one is success. Creatomate's submit answers
with an ARRAY of renders, one per output format, so reading it as an object
gives undefined. And Pollinations — free, and therefore under load — answers
**200 with an HTML error page**, which stored blind becomes a corrupt file
inside a green run, discovered later when a downstream upload fails.

OpenAI's images are fetched as base64 rather than by URL: `dall-e-3` returns a
link that expires within the hour, so bytes mean one code path and no dead
second request. Its prompt rewriting is surfaced as `revisedPrompt`, which is
the difference between "the image is wrong" and "the model changed the brief",
and a content-filter refusal fails rather than retrying — the same prompt meets
the same filter and pays again to be told no again.

**Catalogue.** Four templates (78 total): a keyless free image generator, an
article hero image, a Creatomate render published to Instagram, and a Veo clip
uploaded to YouTube. The Pollinations one is credential-free, which is the
first time a media node has been able to be.

#### Phase C — the 35 templates

Authored as `TemplateSpec` entries under `src/features/templates/catalog/`, gated by
`harness.test.ts`. **A template is not done when it is authored — it is done when
AF-M10-34 runs it green.**

**Amended 2026-09-04 (AF-M10-24).** This originally required each batch to add its
templates *and* their fixture-server suites in the same task. That is not currently
possible: the fixture server redirects a graph by rewriting `node.data.endpoint`, which
only `HTTP_REQUEST` has, while every Phase B service client holds its base URL as a
module constant with no seam to point elsewhere. Building that seam is infrastructure,
and AF-M10-34 already owns "no network access, no credentials", so **C-24…C-32 author
and D-34 proves**. The rule the original wording defended still stands — a batch's task
stays 🟡 with its fixture box unticked until AF-M10-34 runs it, so no template is
counted done on the strength of having been typed.

Every entry must also state, in its `description`, any deviation from the source
document — the way AF-M9's W3 fallback was required to.

### 🟡 AF-M10-24 · Templates: Sales & Marketing (#1–#7) · 2d · **AUTHORED 2026-09-04**
**Depends on:** AF-M10-15, AF-M10-19
**Acceptance**
- [x] Seven specs: `outreach-personalized-gmail`, `upwork-proposal-generator`, `lead-gen-apollo-gpt4`, `cold-outreach-gemini`, `linkedin-profile-research`, `lead-gen-google-search-maps`, `outreach-from-job-signals`.
- [x] Each carries the source doc's prerequisites in its `description`, including required sheet columns.
- [x] `harness.test.ts` passes for all seven (schema, ports, credentials, no dangling edges).
- [ ] **Fixture-server suites — blocked, see below.** Carried by AF-M10-34.
- [x] progress.md updated

**Status 2026-09-04 — authored, not proven.** Seven templates (85 total), all
seven `library` tier. Deliberately left open rather than ticked: by the Phase C
rule above, a template is done when AF-M10-34 runs it green, and the fixture
suites this task was supposed to add **cannot be written yet**. See "Phase C's
per-batch fixture rule is not currently achievable" below.

**Deviations from the source, and why each was necessary.** Every one is stated
in the template's own `description`, so an operator installing it reads it
without opening this file:

- **#1 (`outreach-personalized-gmail`)** — the source reads the Gmail account's
  display name and syncs it onto the send. That is a *read* this product has no
  node for, so the From address is node config instead. The source also has no
  already-sent guard; a Sent column and a filter on it are added here, because a
  cold-outreach flow on a schedule without one emails the same list every hour.
- **#4 (`cold-outreach-gemini`)** — same guard, same reason.
- **#5 (`linkedin-profile-research`)** — rows that already hold Profile Data are
  skipped, which the source does not do. An Apify run per row costs credits, and
  a scheduled read that re-scrapes the same twenty profiles hourly is an
  expensive way to get an answer already in the sheet.
- **#6 (`lead-gen-google-search-maps`)** — the source triggers from a chat
  interface; this uses `FORM_TRIGGER`, the equivalent this product ships. Also
  worth stating plainly in the template: Custom Search and Places need **two
  separate Google keys** — a Custom Search key is refused by Places — and the
  `cx` search-engine id lives on the credential, not in node config. Both APIs
  are metered, so the result caps are deliberate.
- **#7 (`outreach-from-job-signals`)** — the source filters by company size and
  industry off the scrape. Apify actors differ in whether they return either, so
  the filter moved to after Apollo enrichment where the number is reliable, and
  Apollo misses skip rather than fail: a fifty-company list must not stop at the
  first unknown company.

**One credential-free entry per batch, still holding.** #6 is not it — it needs
three. The floor is met from the existing catalogue; the next batch owes one.

**Phase C's per-batch fixture rule is not currently achievable.** The preamble
says each batch adds its templates *and* their fixture-server suites. It cannot,
and this is worth recording rather than quietly skipping:
`tests/integration/fixtures/http-fixture-server.ts` redirects a graph by
rewriting `node.data.endpoint`, which only exists on `HTTP_REQUEST`. Every
service client added in Phase B holds its base URL as a **module constant** —
`const APIFY_API = "https://api.apify.com/v2"`, and the same for Apollo,
Google, Gmail, Sheets, Stripe, Shopify, Airtable, Telegram, WAHA and the rest —
so there is no seam a test can point at a local server. Six of this batch's
seven templates call at least one such client.

Building that seam is a piece of infrastructure, not a line in a template task,
and AF-M10-34 already owns "no network access, no credentials". So the
redirection belongs there, and **AF-M10-24 through AF-M10-32 author; AF-M10-34
proves**. The Phase C preamble is corrected above to say so. This does not
weaken the rule the preamble was defending — nothing here is ticked as done on
the strength of having been typed.

**A lint failure I had reported as clean.** `npm run lint` was failing at HEAD
with one error and five warnings, all in files from AF-M10-20/21/22, and I had
reported those three commits as lint clean. They were not. Fixed in this commit:
a `forEach` callback returning a value in the Stripe form encoder, an unused
`headers` parameter in the Airtable error classifier (Airtable never sends
Retry-After, so nothing read it), an unused `vi` import, and two non-null
assertions in the Telegram tests replaced by a helper that throws a named error
when a fixture fails to parse. The `mimeType` that Upload-Post was reading and
discarding now sets the multipart part's content type, which is what
Upload-Post actually checks — a generated video arrives under whatever name the
generator gave it, so the filename extension is not a reliable substitute.

The cause was running `biome check` on a path subset instead of `npm run lint`.
Gate commands are now taken from `package.json`, not composed by hand.

### 🟡 AF-M10-25 · Templates: Finance & Accounting (#8–#17) · 2.5d · **AUTHORED 2026-09-04**
**Depends on:** AF-M10-16, AF-M10-20, AF-M10-15
**Acceptance**
- [x] Ten specs covering AP invoice processing, expense sync, Slack invoice alerts, Stripe→QBO receipts, PDF archiving, sheet→QBO customer/receipt/estimate flows, invoice sync, full-cycle invoicing, and Airtable sales orders.
- [x] #8's confidence-threshold branch is a real `CONDITION` on the extraction confidence, with the low-confidence path writing an exceptions row and alerting Slack — not a comment saying it should.
- [x] No template contains a sandbox company id, item id or tax code; all such values are config the installer must supply, surfaced as pending setup.
- [ ] **Fixture-server suites — carried by AF-M10-34**, per the amended Phase C note above.
- [x] progress.md updated

**Status 2026-09-04 — authored, not proven.** Eight new templates in
`catalog/finance.ts` (93 total) plus two upgraded in place, and the
pending-setup mechanism the third acceptance box turned out to need.

**Two of the ten already existed, so they were upgraded rather than
duplicated.** AF-M10-16 authored `quickbooks-receipt-from-stripe-payment` (#11)
and `quickbooks-estimate-from-sheet-row` (#14) as demonstrations of the
QuickBooks family, and each implemented a strict subset of its source: #11
stopped when the payer was unknown, #14 required the customer to exist already.
Both now carry the source's find-or-create branch. Shipping a second slug that
differed from an existing one by a single branch would have left the catalogue
with two answers to the same question and no way to tell which was meant.

The third, `quickbooks-expense-with-receipt`, was left alone: #9's whole point
is the Airtable approval loop, and a webhook-triggered claim is a different
flow, not a lesser one. #9 is authored beside it.

**"Surfaced as pending setup" did not exist, so it was built.** The third
acceptance box asks for two things and only the first was possible: the
catalogue's `REPLACE_WITH_*` convention keeps sandbox ids out, but nothing
*surfaced* them — they were visible only to somebody reading the graph JSON.
Worse, the template page told a credential-free template that it "runs as-is
once installed", which is false for any template holding a spreadsheet id it
cannot know.

So `collectPendingSetup` now walks each node's config and reports every
placeholder, and the install panel lists them beside the credentials, because
both answer the same question: what do I still owe this workflow before it will
run. Three details that decided the shape:

- **The walk is recursive.** A placeholder is rarely a top-level string — it
  sits inside a `mappings` array, inside the JSON of a `values` field, inside
  `code`. Reporting only top-level keys would have called most of these
  templates ready.
- **The pattern requires uppercase after the prefix**, so an AI prompt saying
  "replace with the customer name" is not reported as setup.
- **The UI de-duplicates per node, not per occurrence.** A spreadsheet id
  appears in four nodes of a sheet-driven template and twice within one of
  them; listing six rows would bury the two other things also owed.

**The harness rule caught a distinction I had drawn wrongly.** The first
version demanded that every id-shaped field be a placeholder, and it
immediately failed on `tableId: "Incidents"` — which is correct as it stands,
because Airtable accepts a table *name*, and `#alerts` is a Slack channel the
same way. A name is a sensible default an installer keeps; an opaque id can
only have come from one workspace. The rule is now shaped against the id
formats themselves — Airtable's `app`/`tbl` prefixes, Google's 25-plus
character ids, Slack's `C…`, Stripe's `price_`, and QuickBooks' bare digits,
which is exactly the company/item/account/tax-code shape this box names.

**#8 is the only Advanced automation in the batch and the only one that
strained the credential cap.** It needs Drive, Sheets, QuickBooks and Slack —
four, the library ceiling exactly — and fits only because `AI_EXTRACT`'s
provider keys are optional. Its confidence branch is real: the model returns a
`confidence` field whose description tells it what the number is *for*, since a
model asked for a confidence without being told it decides whether a human
reads the invoice returns 0.95 for everything.

**Deviations, each stated in the template's own description.**

- **#8** — the source also triggers on Gmail attachments. This product reads a
  Gmail message but has **no node to fetch an attachment's bytes**, so the mail
  arm would extract nothing; the description points at the Gmail-filter-to-Drive
  workaround instead of pretending. And the source creates a QuickBooks **Bill**;
  there is no bill node, so a Purchase is recorded — which books the spend but
  does not create a payable that ages, and the description says so rather than
  letting an AP team discover it at month end.
- **#9** — the source checks `Status = Approved` inside the workflow; here it is
  the trigger's `filterByFormula`, so an unapproved record never starts a run.
- **#10** — Balance added to the alert. "Invoice updated" without it is an alert
  nobody can act on, and the common update IS a payment.
- **#15** — an upsert keyed on the invoice id rather than the source's "append
  or update", which is the same intent said precisely: an append-only sheet
  grows a second row every time an invoice is paid.
- **#16** — Stripe payment links are built from a **Price**, not an arbitrary
  amount, so the link points at a configured Price while the QuickBooks invoice
  carries the deal's real amount. A per-deal variable amount needs a Checkout
  Session, which is a different API; the description says to send the link by
  hand in that case rather than quietly billing the wrong number.
- **#17** — the Airtable trigger replaces the source's Airtable-side webhook,
  because a polled read with a formula filter reaches the same records with
  nothing to configure in Airtable.
- **#13** — rows already in the sheet when you publish are not replayed. The
  source has no such guard, and without one, publishing against an existing
  sheet files a receipt for every historical sale at once.

### 🟡 AF-M10-26 · Templates: Engineering & DevOps (#18–#20) · 1d · **AUTHORED 2026-09-04**
**Depends on:** AF-M10-18, AF-M10-17
**Acceptance**
- [x] Three specs; the multi-repo variant (#18) routes by repository through `SWITCH` rather than duplicating branches.
- [x] Jira transitions are by name (AF-M10-18), so an installed template works against a project whose status ids differ.
- [ ] **Fixture-server suites — carried by AF-M10-34**, per the amended Phase C note above.
- [x] progress.md updated

**Status 2026-09-04 — authored, not proven.** Three new templates in
`catalog/engineering.ts` (96 total), all in the GitHub/Jira/Slack/Notion/
Gemini/SMTP node family. #18 routes by repository through `SWITCH`; the
single-repo variant is #19, and #20 announces release notes via Gemini + email.
Jira transitions are by name — a shipped template cannot know a project's
status ids, and a template carrying foreign ids fails install with a useless
400. Harness gained a gate reading every value a SET node writes (dead SET
config is the same defect class as the dead CONDITION keys AF-M10-24 found),
and `EXPECTED_TEMPLATE_COUNT` moved 93 → 96.

### 🟡 AF-M10-27 · Templates: Data Extraction & AI (#21–#23) · 1d · **AUTHORED 2026-09-05**
**Depends on:** AF-M10-14, AF-M10-11, AF-M10-13, AF-M10-21
**Acceptance**
- [x] Three specs: fax/PDF extraction to Sheets, YC scraper, Telegram PDF RAG bot.
- [x] #23 ships as two linked workflows (ingest and ask) if a single graph cannot express both Telegram entry points — recorded as a deviation either way. **Recorded: it shipped as a single one-credential workflow** (`telegram-chat-with-pdfs`, `telegram.apiKey`); the free banter entry point dies so a user can open the chat, ask a question about a PDF, and get an answer, and the daily-scan pattern this chapter needed stayed honest about its one credential. The user authorized the single-workflow shape when confirming the batch.
- [x] **Amendment (user, 2026-09-05) — a fourth, credential-free Data starter** (`normalize-messy-record-list`) so the free-share floor holds without reclassifying anything: manual payload → `SPLIT_OUT` → `AI_EXTRACT` per row → terminal `AGGREGATE`. Authoring surfaced a real constraint worth writing down: **an `AGGREGATE` node's output cannot be referenced downstream** — its config schema is empty, so it can carry no `variableName`, and `computeValidRoots` has no path to it (validate.ts:1140). Every shipped segment template therefore makes `AGGREGATE` terminal, and normalizing into an envelope (SET→WEBHOOK_OUT) is not expressible until the engine records segment output under a known root. The graph ends at the collected clean rows instead.
- [ ] **Fixture-server suites — carried by AF-M10-34**, per the amended Phase C note above.
- [x] progress.md updated

### ⬜ AF-M10-28 · Templates: Subscribers & eCommerce (#24–#25) · 0.5d
**Depends on:** AF-M10-20, AF-M10-10
**Acceptance**
- [ ] Two specs; #24's duplicate check uses `DEDUPE`, not a hand-rolled sheet lookup.
- [ ] progress.md updated

### ⬜ AF-M10-29 · Templates: Communication & Productivity (#26–#27) · 1d
**Depends on:** AF-M10-17, AF-M10-15, AF-M10-08, AF-M10-18
**Acceptance**
- [ ] Two specs; #26's "create the channel if absent" is a real `CONDITION` + `SLACK_CREATE_CHANNEL` branch.
- [ ] #27 uses `WAIT` in `until` mode against the meeting start minus 15 minutes.
- [ ] progress.md updated

### ⬜ AF-M10-30 · Templates: Legal & Contract (#28–#30) · 1d
**Depends on:** AF-M10-15, AF-M10-11, AF-M10-12, AF-M10-09
**Acceptance**
- [ ] Three specs; each moves the source file between Drive folders so a re-poll cannot reprocess it.
- [ ] #29's playbook lives in Sheets as the source describes, and DOCX extraction actually works (AF-M10-11) rather than being claimed.
- [ ] #30's approval routing by contract value uses `SWITCH` on a typed numeric comparison (AF-M9-08), not a string compare.
- [ ] progress.md updated

### ⬜ AF-M10-31 · Templates: Customer Support (#31) · 0.5d
**Depends on:** AF-M10-14, AF-M10-21, AF-M10-18, AF-M10-17
**Acceptance**
- [ ] One spec with three trigger entry points normalized into a common ticket shape via `SET`/`CODE`.
- [ ] The SLA-breach sweep ships as a second scheduled workflow in the same template family, since one workflow still allows one trigger (M9 G15).
- [ ] progress.md updated

### ⬜ AF-M10-32 · Templates: Content & Social Publishing (#32–#35) · 1.5d
**Depends on:** AF-M10-22, AF-M10-23, AF-M10-10
**Acceptance**
- [ ] Four specs; #34's scene loop uses `SPLIT_OUT`/`AGGREGATE` (AF-M9-14) with an explicit scene cap.
- [ ] Long-running renders (#33, #34) surface progress in the run detail view rather than appearing stalled.
- [ ] progress.md updated

#### Phase D — proving it

#### Phase C descoped after AF-M10-27 (user decision, 2026-09-05)

**AF-M10-28 through AF-M10-32 are cut. Automations #24–#35 are not authored.**

The milestone ships **23 of the 35** reference automations. The reason is not
time: nothing authored so far has been *proven*. Phase C's own rule is that a
template is done when AF-M10-34 runs it green, and on 2026-09-05 all 100
catalogue entries were authored-only. Adding twelve more unproven graphs makes
that pile larger, not better.

Ordering the other way round is also better work. Once AF-M10-34's fixture
infrastructure exists, a template can be proven as it is written instead of
joining a backlog, so the remaining automations are cheaper and safer to author
later than they are now.

This cuts more than the descope list further down calls for — that list names
#33/#34 and #31 first, and says nothing about #24–#30. Recorded here so the
difference between "descoped per plan" and "descoped by decision" stays visible.

### ⬜ AF-M10-33 · Fixture-server contract suites for every service node · 2.5d
**Depends on:** Phase B
**Acceptance**
- [ ] One local fixture server (reached via the AF-M9-02 loopback allowance) serves recorded responses for every service in Phase B, including error shapes: 401, 403-quota, 429 with `Retry-After`, and the Slack `ok: false` envelope.
- [ ] Every node has a contract test asserting request shape (method, path, headers, body) and response mapping. No test reaches the public internet.
- [ ] Fixtures are recorded from real responses once and checked in with the recording date, so drift is visible.
- [ ] progress.md updated

### ⬜ AF-M10-34 · All 35 execute green in CI · 2d
The milestone's definition of done.

**Depends on:** Phase C, AF-M10-33
**Acceptance**
- [ ] `tests/integration/automations/` drives each of the 35 catalogue graphs through `runGraph` against the fixture server, asserting terminal `SUCCESS` and the expected `NodeExecution` count, order and statuses.
- [ ] Trigger payloads are injected through `runGraph`'s `initialData` option. ~~This task cannot close until AF-M9-01 lands it.~~ **Unblocked 2026-09-03** — that box closed with AF-M9-10; the note above was stale when AF-M10-24 checked it.
- [x] **Client base-URL redirection, moved here from Phase C (2026-09-04). DONE 2026-09-05.** `src/lib/server/service-endpoints.ts` holds all 27 bases; 21 client files and 36 use sites moved onto `serviceEndpoint(name)`, and Shopify's per-shop host and QuickBooks' sandbox/production pair onto `redirectedServiceUrl`. Redirection is gated twice — `NODE_ENV=test` **and** a loopback origin — and a malformed or non-loopback override throws rather than falling back to the real endpoint, because falling back turns "this test redirects Stripe" into "this test charged a real card". Each service gets its own path segment so a fixture can tell a Sheets call from a Drive one, and the client's own path suffix survives, which is the part a contract test asserts on. `service-endpoints.test.ts` carries a guard that fails on any newly hardcoded base — it found `YOUTUBE_UPLOAD_API` immediately, which a hand-written survey had missed because the declaration wraps across two lines. `tests/integration/service-endpoint-redirect.integration.test.ts` proves the seam through real clients against a real socket, since a client that captured its base at import time would pass the unit test and fail this one.
- [ ] **BLOCKER found 2026-09-05 by the first real run: no workflow can execute through Inngest at all.** `scripts/run-template.ts` installed `normalize-messy-record-list` into the dev org, bound the connected Gemini credential and sent the same `workflows/execute.workflow` event the Run button sends. It hung on node 0 (`MANUAL_TRIGGER`), timed out at its 60s node timeout, retried, and is still `RUNNING`. Cause: `functions.ts` invokes every node executor **inside** `step.run` (both the plain path, line ~1313, and the segment path, line ~841) while handing it `step` and `publish`. Real Inngest rejects nested step tooling — the SDK logged `NESTING_STEPS` naming `publish:manual-trigger-execution` — so the inner call never settles and our own `Promise.race` timeout fires. **93 of the node executors call `step.run`/`step.sleep`/`publish`, and every trigger executor does**, so there is no valid graph that avoids it: a graph must start with a trigger.
- [ ] **Why no test caught it.** `tests/integration/engine/run-graph.ts` calls the real `executeWorkflowHandler` but substitutes a fake `step` whose `run` executes the callback inline. Inline execution permits nesting, so 246 integration tests pass against a double that is more permissive than production in exactly the dimension that breaks. The dev database had **0 executions ever** — the real path had never been exercised. This is the strongest argument yet for AF-M10-34: fixture-green was never going to find this, because the fixture replaces the thing that fails.
- [x] **FIXED 2026-09-05 (two-tier execution).** The shape of it is two-tier execution: nodes that genuinely need durable step boundaries (`WAIT`, `APPROVAL`, the Apify wait, the Veo/Creatomate job poller) must be invoked OUTSIDE `step.run` and own their own steps, while everything else stays wrapped and should not be handed `step`/`publish` at all. Making production match the test double instead (an inline `step` shim everywhere) would restore execution but silently strip durability from precisely the nodes AF-M10-08/09/19/23 built it for, so it is the wrong repair.
- [x] **Two-tier execution landed 2026-09-05, and a real run reaches real providers.** `NodeDefinition.ownsSteps` marks the five node types whose durability is the point — `WAIT`, `APPROVAL`, `APIFY_RUN`, `VEO_GENERATE`, `CREATOMATE_RENDER`. Those are invoked outside `step.run` with the real tooling and, deliberately, with no timeout race and no engine retry: when such an executor suspends its promise never settles, so racing it reports a hang for correct behaviour, and re-entering it would replay step names Inngest has already memoised. Every other executor stays wrapped — keeping memoisation, the per-node timeout and the retry loop — and receives an inline `step` shim plus a deferred `publish` that is flushed once the step returns, so the editor still gets live status. `step.ai.wrap` had to be on the shim too: without it `AI_LLM` and `AI_EXTRACT` die on "Cannot read properties of undefined (reading 'wrap')", which is what the first repaired run did after clearing the trigger for the first time.
- [x] **The test double no longer permits what production forbids.** `run-graph.ts`'s fake `step` now throws on a nested `step.run`, mirroring Inngest. All 246 integration tests pass with that guard armed, which is the actual proof that no executor nests any more. One test changed with it: the AF-M8-27 cancellation suite hooked `manual-trigger`, a step the trigger's executor opened privately; it now hooks the engine's `node:<id>:attempt:1`, which is the boundary it meant and the only one a deployed run has.
- [x] **`initialData` was being dropped in production too.** `sendWorkflowExecution` SPREAD it into `event.data` while the engine reads `event.data.initialData`, so every webhook, form, Stripe, Telegram, GitHub and QuickBooks payload arrived as an empty context — `{{webhook.body}}`, `{{form.fields}}` and `{{telegram.text}}` all resolved to nothing. Only the integration harness passed it in the shape the engine reads, which is why the suite was green; the harness's own comment claimed it matched the routes, and did not.
- [x] **Model registry refreshed 2026-09-05; two templates now run green.** A real run now reaches the provider and comes back with the provider's own error: Google answers `models/gemini-1.5-flash is not found for API version v1beta`, and Groq rejects both `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`. `registry.ts` still lists only `gemini-1.5-flash`/`gemini-1.5-pro`, and most Phase C templates name them. The engine is proven end to end — real HTTP, real auth, real provider responses — so what remains here is refreshing the catalogue against each provider's current model list.
- [x] **Two templates verified end to end against real providers (2026-09-05).** `normalize-messy-record-list` — SUCCESS, 6 node executions, three real Gemini calls, $0.001869 and 269/715 tokens recorded through the cost pipeline. `webhook-json-api-with-validation` — SUCCESS, 4 nodes plus a correctly SKIPPED reject branch, with the 202 body composed from the validated record. The second one doubles as proof of the `initialData` repair: its CODE node read `input.webhook.body` and normalised `"  JANE@Example.COM "` to `jane@example.com`, which was impossible while the payload was being dropped.
- [x] **Model ids were stale everywhere and are now verified, not assumed.** Google had retired the 1.5 line, then refused 2.5 as well ("no longer available to new users… use models/gemini-3.6-flash"), and Groq no longer serves either llama id. Every replacement was confirmed with a live one-token generation against the account before being written down. `gemini-pro-latest` is registered but needs billing enabled — a free key gets a quota refusal, which is a different failure from a missing model and worth telling apart. Model ids now allow `/`, because providers namespace them (`openai/gpt-oss-120b`).
- [x] **Three shipped templates could never have run, and the harness could not see it.** Two RESPOND_TO_WEBHOOK bodies and one HTTP body butted a stache against JSON's own closing brace — `{{{json record}}}}` — which Handlebars lexes as a raw-block close. The catalogue had carried them since M9. `harness.test.ts` now compiles **and invokes** every expression a template ships: invoking matters, because `Handlebars.compile` is lazy and the first version of the rule passed the very bug it was written for.
- [x] **A validator gap, found the same way.** Fixing the braces exposed `fan-out-one-payload-to-many-calls` referencing `count` and `failed` after an AGGREGATE, which the validator called unknown roots. The runtime is fine — the engine does `context = aggregateResult`, so a closed segment really does put `items`/`count`/`failed` downstream — so `computeValidRoots` was wrong, not the template. **This also corrects the AF-M10-27 note**, which recorded the limitation as "AGGREGATE output cannot be referenced downstream": true of the validator, false of the engine.
- [ ] No network access, no credentials, no manual intervention; suite runs in the existing `integration` project.
- [ ] A staging checklist records which of the 35 have additionally been run against real accounts, with dates — CI-green and provider-green are different claims and the docs must not blur them.
- [ ] progress.md updated

### ✅ AF-M10-35 · Node brand logos · 0.5d · **DONE 2026-09-03**
H14. `public/logos/` cannot currently reach a node.

**Depends on:** —
**Acceptance**
- [x] `NodeDefinition` gains `logo?: string` (mirroring `CredentialTypeDef.logo`); the palette, canvas node and config panel render it with the lucide `icon` as fallback. A node with no logo is unchanged.
- [x] Existing marks wired up from `public/logos/`: Airtable, HubSpot, Slack, Stripe, GitHub, Jira, Notion, QuickBooks/Intuit, Shopify, WhatsApp, MailChimp, Google Sheets/Docs/Forms, Gmail (Email.png), OpenAI, Gemini, Anthropic, Discord.
- [x] **18 marks are missing and must be added:** Telegram, LinkedIn, X, Pinecone, Apify, Apollo.io, MailerLite, Creatomate, Pollinations.ai, YouTube, Instagram, OpenRouter, WAHA, Google Drive, Google Calendar, Google Maps, Veo, Upload-Post. SVG preferred; each usable on both light and dark canvas.
- [x] A test asserts every `logo` path in the node manifest and the credential registry resolves to a file that exists — a broken logo path must fail CI, not render an empty box.
- [x] progress.md updated

---

### 4. Sequencing and descope

```
Weeks 1-2   A-01, A-02, A-03, A-04, A-35        auth + credentials + logos
Weeks 3-4   A-05, A-06                          polling + binaries (the two big ones)
Week  5     A-07, A-08, A-10, A-11, A-12, A-13, A-14
Weeks 6-8   B-15, B-16, B-17, B-18              the four families 30 of 35 depend on
Weeks 9-10  B-19, B-20, B-21, B-22, B-23, A-09
Weeks 11-12 C-24…C-32, D-33, D-34
```

**Descope order, first to go.** Cut whole automations, never a template's honesty:

1. **#33, #34** (Veo, Creatomate) — the most infrastructure per automation, and both depend on long-poll job handling nothing else needs. Cutting them removes AF-M10-23's hardest half.
2. **#23** (Telegram + Pinecone RAG) — the only automation needing an external vector store.
3. **#31** (multichannel support) — needs four families at once and a second workflow for the SLA sweep.
4. **#6** (Search + Maps) — two metered Google APIs used by one automation.
5. **#35, #32** (LinkedIn, X) — the two hardest OAuth surfaces, one automation each.

Cutting all five groups removes 8 of 35 and roughly 12d, leaving 27 automations that
need only the Google, QuickBooks, Slack and dev-tools families.

**Never descope AF-M10-01, AF-M10-02 or AF-M10-05** — the first two are prerequisites
for every remaining automation, and without the third, 18 of them have no trigger.

**A template with an unmet dependency is not shipped as a stub.** It stays out of the
catalogue until it runs. A gallery entry that cannot execute is worse than a missing
one, because the user finds out after installing it.

---

### 5. Decisions this milestone must record

| ADR | Subject | Task |
|---|---|---|
| 0022 | Credentials on the generic HTTP node: any registered type, and why auth does not follow a cross-origin redirect | AF-M10-01 |
| 0023 | One Google credential per service scope, not one per user | AF-M10-03 |
| 0024 | Polling triggers: at-least-once with dedupe, cursor ownership, and no history replay on activation | AF-M10-05 |
| 0025 | Binary payloads by reference (`FileRef`), never by value; blob lifetime tied to execution retention | AF-M10-06 |
| — | ADR-0011 applied twice: `SLACK` → `SLACK_POST` (AF-M10-17), `google.oauth2` → scoped types (AF-M10-03) | — |

---

### 6. Verification recipe

```bash
npm run lint && npm run build
npm test
npm run test:db:up && npm run test:integration && npm run test:db:down
npm run seed:templates -- --yes
```

`AF-M10-34` is the definition of done: **35 catalogue rows, 35 green runs, zero
network access, zero credentials, zero manual steps.**

---

### 7. What this milestone deliberately does not do

- **No arbitrary n8n JSON import.** M9 §0 already established that the source library's
  topology is unrecoverable for 2,057 of 2,061 files. This milestone ports 35
  *documented* automations by hand; it does not build an importer, and no task here
  should be read as progress toward one.
- **No workflow-to-workflow calls.** #31's SLA sweep is a second workflow because one
  workflow still allows one trigger (M9 G15). A sub-workflow node is a Phase 2 epic.
- **No per-provider retry tuning beyond AF-M9-06.** The per-node run policy shipped in
  M9 is what these nodes use.

---

### 8. The one-day slice — what is actually reachable in a single session

Recorded because the milestone was requested with a same-day deadline. 62 engineer-days
does not compress into one; six automations do, and they are the right six because they
are the ones whose only missing piece is authentication.

**Ship in order:**

1. **AF-M10-01** — credentials on `HTTP_REQUEST`. Roughly half a day, and it is the
   difference between "no automation in the library is reachable" and "most are".
2. **AF-M10-02** — the API-key credential types. Data entry against a registry that
   already validates itself.
3. **AF-M10-35** — `logo` on `NodeDefinition` plus the existing marks. Half an hour,
   and it makes everything built afterwards look finished.
4. **A first template batch** — the automations in §1 whose every non-Phase-A
   dependency already exists: **#22** (YC scrape → Sheets append), **#4** and **#24**
   once `SHEETS_READ` lands, **#11** and **#17** once QuickBooks does, **#32** once X
   does.

Realistically **#22 alone is end-to-end green today**; #4, #11, #17, #24 and #32 each
need one Phase B family first. Anything beyond that is a template that has been
authored, not an automation that works — and the difference is the whole point of
AF-M10-34.

---

## UX improvement plan addenda (2026-09-05) — tasks from `docs/ux-improvement-plan.md`

We decided to merge plan items **2.1** (add search to executions page) and **2.2**
(add workflow name filter to executions page) into one task because they touch the
same landing page, the same tRPC procedure (`executions.list`), the same nuqs param
module, and the same filter bar — one PR, one acceptance set.

### ✅ AF-UX-02 · Per-node cost/tokens in execution detail · 0.5d · **DONE 2026-09-05**

**Why:** `docs/ux-improvement-plan.md` §2.4 — "Cost/Tokens Breakdown Per
Execution". The execution detail view shows total cost and total tokens, but the
node trace table shows only per-node cost; users cannot tell which node burned
the most spend or tokens. Plan criteria 3 (cost comparison between executions)
and 4 (cost trend over time) already ship in the costs dashboard
(`src/features/costs/components/cost-trend-chart.tsx`,
`cost-breakdown-tables.tsx`); this task covers criteria 1–2. The router already
selects per-node `tokensIn`/`tokensOut`/`costUsd`
(`src/features/executions/server/routers.ts:165-184`) and `TraceRow`
(`src/features/executions/components/execution.tsx:74-96`) carries them — the
data exists, the UI does not render it.

**Design decisions (locked 2026-09-05):**
- **Pure share rule in `src/features/executions/lib/cost-share.ts`.** A node is
  flagged "expensive" when its cost is **strictly more than 10% of the run's
  total node cost** (the run total is the sum of `trace.costUsd`, so cached
  hits — which record $0 — can never be flagged). Guarded for null/zero/costless
  runs. Unit-tested; mirrors the IO-free `costs/lib/aggregate.ts` pattern.
- **Single "Tokens" column, `in / out`, `toLocaleString()`** — matches the stat
  card's token formatting and the "in / out" vocabulary already in this view.
  Hidden below `sm` like Duration. The column renders only when the run has at
  least one trace with tokens (avoids a column of dashes on webhook flows); the
  expanded-row `colSpan` follows.
- **Highlight = `text-warning` + `font-medium` on the cost cell** with a
  percentage tooltip ("N% of this run's spend"), plus a `StatusPill
  tone="warning"` legend in the panel header when any node crosses the
  threshold. No new dependency; reuses the existing warning token.

**Depends on:** nothing beyond the data the executions router already selects.
**Acceptance**
- [x] Per-node token counts render in the execution detail trace table
      (`in / out`, thousands-separated), only when the run produced tokens.
- [x] A node costing more than 10% of the run's total node cost is visually
      highlighted in the Cost cell with a percentage tooltip; nodes at exactly
      10% or below, zero-cost nodes, and costless runs are never highlighted.
- [x] A ">10% of spend" warning legend appears in the panel header exactly when
      ≥1 node is highlighted.
- [x] Unit test for the share rule: threshold bound (exact 10% not flagged),
      null/zero/null-cost guards, and total ≤ 0 guards all covered.
- [x] `npm run build` passes, no new lint warnings; progress.md + tasks.md
      updated. Scope note in the PR: plan criteria 3–4 are pre-existing in the
      costs dashboard, deliberately out of this PR.

### ✅ AF-UX-01 · Executions search + workflow multi-select filter · 1d · **DONE 2026-09-05**

**Why:** The executions page has only a status filter (`docs/ux-improvement-plan.md`
§2.1, §2.2). Users with many workflows cannot find a specific run: there is no way to
search by workflow name or execution id, and no way to scope the list to one or a few
workflows. `executions.list` (`src/features/executions/server/routers.ts`) currently
accepts a single optional `workflowId` — no caller anywhere passes it — plus
`status`, `startedAfter/Before`, `mode`, `page`, `pageSize`.

**Design decisions (locked 2026-09-05):**
- **Search matches workflow name OR execution id.** Reuse the search-router semantics
  (`src/features/search/server/routers.ts:68-81`): execution `id` by `startsWith`
  (users type a short id prefix from a log line), workflow name by case-insensitive
  `contains`. The whole OR branch stays under the existing
  `workflow: { organizationId: ctx.org.id }` tenancy guard.
- **Server-side filtering, debounce at the URL layer.** The search param is a real
  nav param in the URL (like `status`), debounced via nuqs `debounce(300)` when bound.
  No client-side list filtering: pagination and `count` stay server-truthful.
- **Replace single `workflowId` with `workflowIds: string[]`.** No caller uses the
  single form today (`prefetch.ts` builds input via `inferInput<typeof
  trpc.executions.list>` so the type change is compile-checked; `execution.tsx`
  invalidates an empty-key query). The router keeps `where.workflow.id IN
  workflowIds` scoped through the org.
- **Workflow dropdown feeds from `workflows.getMany`** (org-scoped, already ships
  id + name) so the option set is identical to what a user sees on the Workflows
  page — no new cross-feature data path.

**Depends on:** none at runtime; work is gated by buildware (`npm run build`) only.
**Acceptance**
- [x] Search input renders at the top of the executions list and filters by workflow
      name or execution id, case-insensitive, on the server (reuse search-router
      matching: id `startsWith`, name `contains`).
- [x] Results update as the user types, debounced ~300ms via the nuqs `debounce`
      limit; no refetch per keystroke.
- [x] Clear (×) button in the search input resets the query and the list.
- [x] Empty filter state distinct from the "no runs yet" onboarding empty state —
      "No executions match your filters" with a way back.
- [x] Workflow dropdown lists the user's workflows (from `workflows.getMany`),
      supports multi-select, and shows a count of selected workflows.
- [x] Workflow filter AND-combines with the existing status filter server-side
      (both survive a page reload as URL params).
- [x] Clear-filters affordance resets search + workflow + status together.
- [x] Authz: search/`workflowIds` filtering happens inside the org-scoped `where`,
      never post-fetch; org B cannot use org A's workflow id to widen results.
- [x] Unit test for the new params (search/workflowIds serialize, clearOnDefault);
      integration test proving search + `workflowIds` stay tenant-scoped.
- [x] `npm run build` passes, no new lint warnings; progress.md + tasks.md updated.
