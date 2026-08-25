# AutoFlow — Progress

**Snapshot date:** 2026-08-24 (hardening wave 1)
**Current milestone:** M-A — Audit hardening (security + harness) — then M1 as re-scoped
**Overall vs. PRD Phase 1:** ~28% implemented
**Overall vs. full PRD (Phases 1–3):** ~8%

> **2026-08-22 RECONCILIATION.** The previous version of this document described a
> repository state that did not match the code: it claimed an execution engine did
> not exist, that the canvas could not save, and that M0/M1 tasks were shipped with
> PR numbers colliding with the tutorial history (`code-with-antonio` PRs #17–#30).
> A full audit on 2026-08-22 found the opposite in several places: a working
> Inngest execution engine with 10 registered node executors, functional save,
> executions + credentials UIs, and three triggers. Every claim below is verified
> against file paths. The changelog entries dated before 2026-08-22 describe
> aspirational work and are struck from the record; see §8.

This document records **what is actually built**, verified by reading the code. It is not a plan (`docs/planning/implementation_plan.md`) and not a backlog (`docs/planning/tasks.md`). Update it in the same PR as any change that alters the state below.

---

## 1. Executive status

AutoFlow is a working single-user workflow-automation MVP derived from a tutorial
codebase (~30 lessons merged to `main`, Oct–Nov 2025): React Flow canvas **that
saves**, an **Inngest execution engine** running workflows through a topological
sort with per-node executors and realtime status channels, credential storage
(basic encryption), two webhook triggers plus manual trigger, and execution
history with per-node-type result views. The product loop — build → save →
execute → inspect — exists end to end for one tenant.

What it is not: multi-tenant, tested (zero tests, no CI), lint-clean (303 Biome
errors), or hardened (unsigned webhook trigger, weak encryption, template-injection
surface, SSRF exposure). The gap to the PRD is scope and hardening; the docs tree
previously overstated both directions and has been corrected (§8).

---

## 2. Completion matrix vs. PRD §5

| PRD section | Requirement area | Status | % | Notes |
|---|---|---|---|---|
| 5.1 | Zero-overhead production platform | 🟠 | ~20% | Sentry wired; execution history + error capture exist. No monitoring dashboard, no deploy/versioning/rollback, no quotas, no alerting. |
| 5.2 | Visual builder & nodes | 🟠 | ~40% | Canvas saves via `workflows.update`; 10 node types execute (manual/http/AI×3/discord/slack/google-form/stripe). No palette-driven registry, no schema-driven config panel, no validation/linting, no autosave/conflict handling. |
| 5.3 | Multi-model AI & cost | 🟠 | ~15% | OpenAI + Anthropic + Gemini executor nodes wired through AI SDK v5. No routing/fallback/cost tracking/cache; keys unvalidated at boot (no env module). |
| 5.4 | Governance, security, compliance | 🔴 | ~12% | Better Auth (email/password + GitHub/Google OAuth) + Polar premium gate + Cryptr-encrypted credentials. No RBAC/orgs/audit/SSO/quotas; encryption and webhook auth gaps (§5 S1/S2). |
| 5.5 | Knowledge base & connectors | ⚫ | ~2% | Discord/Slack send nodes only; no generic connector framework, no knowledge base. |
| 5.6 | Multi-agent orchestration | ⚫ | 0% | Nothing. |
| 5.7 | Analytics, ROI, marketplace | ⚫ | 0% | `recharts` installed; no dashboards, templates, or marketplace. |
| 5.8 | Developer platform | ⚫ | 0% | tRPC internal-only; no public API/SDK/CLI/Git sync. |
| 6 | Non-functional | 🔴 | ~10% | TypeScript compiles clean. **Zero tests, no CI, lint failing (303 errors)**, no rate limiting, no load testing, no redacting logger. |

🟢 done · 🟠 partial · 🔴 minimal · ⚫ absent

---

## 3. What works today

### Infrastructure — verified versions from `package.json`
| Capability | Detail |
|---|---|
| Framework | Next.js **15.5.4** (App Router, Turbopack), React **19.1.0**, TypeScript 5 |
| Database | Prisma **6.16.3** + PostgreSQL; **12 migrations** applied (2025-10-04 → 2025-11-01) |
| API | tRPC **11.6** + TanStack Query v5, superjson, SSR prefetch + hydration |
| Auth | Better Auth **1.3.26**, Prisma adapter, email/password + GitHub/Google OAuth |
| Billing | Polar (`@polar-sh/better-auth` 1.1.9) — checkout + portal + `premiumProcedure` gate |
| Jobs | Inngest **3.44.1** + `@inngest/realtime` 0.4.4; `/api/inngest` route; dev CLI via mprocs |
| Errors | Sentry **10.18** (client/server/edge configs) |
| Lint/format | **Biome 2.2.0** (not ESLint) — `npm run lint` = `biome check` |
| Canvas | `@xyflow/react` 12.8, jotai editor state |
| Expressions | Handlebars 4.7 compiled at runtime inside node executors (see S3) |

### Features — verified working
| # | Feature | Evidence |
|---|---|---|
| 1 | Sign up / sign in (email+password, GitHub/Google OAuth) | `src/features/auth/**`, `src/lib/auth.ts` |
| 2 | Route protection + redirect | `src/lib/auth-utils.ts` |
| 3 | Polar checkout, billing portal, subscription state | `src/features/subscriptions/**`, `src/lib/polar.ts` |
| 4 | Premium gate on workflow creation | `src/trpc/init.ts:41` (`premiumProcedure`) |
| 5 | Workflow CRUD: create (slug + INITIAL node), list w/ pagination+search (count shares `where` — correct), rename inline, delete | `src/features/workflows/server/routers.ts:161,10,78` |
| 6 | **Canvas save** — nodes+edges persisted transactionally | `editor-header.tsx:24` → `routers.ts:83` |
| 7 | Execution engine: topo sort (cycle rejection), per-node `step.run`, retries 3 in prod / 0 otherwise, `onFailure` marks run FAILED | `src/inngest/functions.ts:17`, `src/inngest/utils.ts:6` |
| 8 | 10 node executors registered | `src/features/executions/lib/executor-registry.ts`: INITIAL/MANUAL_TRIGGER, HTTP_REQUEST, GOOGLE_FORM_TRIGGER, STRIPE_TRIGGER, GEMINI, OPENAI, ANTHROPIC, DISCORD, SLACK |
| 9 | Realtime per-node status streaming to canvas | `src/inngest/channels/*.ts` (9 channels), `publish()` in every executor |
| 10 | Credentials CRUD + encrypted values | `src/features/credentials/**`, `src/lib/encryption.ts` (Cryptr — see S2) |
| 11 | Triggers: manual run button, Google Form webhook, Stripe webhook (unauthenticated — see S1) | `src/features/triggers/**`, `src/app/api/webhooks/{google-form,stripe}/route.ts` |
| 12 | Execution history: list + detail with per-node-type output components, status polling | `src/features/executions/components/**`, routers `executions.getMany/getOne` |
| 13 | Dashboard shell: sidebar nav, header, upgrade modal | `src/components/app-sidebar.tsx` |
| 14 | Graph data model | `prisma/schema.prisma` (`Workflow`, `Node`, `Connection`, `Execution`) |

---

## 4. What is stubbed or missing

### Missing routes
| Route | Actual content |
|---|---|
| `/` | **Does not exist** — no `src/app/page.tsx`; sidebar logo 404s. |

*(The previous revision listed `/executions` and `/credentials` pages as `<p>` stubs — false since the lesson-27+ code; they are fully built.)*

### Blocking gaps (re-scoped)
| # | Gap | Consequence |
|---|---|---|
| B1 | ~~Canvas persistence~~ **RESOLVED** — save works | — |
| B2 | Node catalogue is a hardcoded Prisma enum + scattered executor files; adding a node = migration + edits in ≥5 places | Node library cannot scale; blocks palette/config-panel/validation work (M1) |
| B3 | Engine runs **every node in topo order regardless of edges taken** — no branching/skip semantics, no per-node trace records | Condition-style workflows impossible; debugging limited to final outputs |
| B4 | No tests, no CI | Nothing verifies refactors; engine correctness is anecdotal |
| B5 | Triggers have no authentication (S1) and no scheduling/cron | Workflows start manually or via open webhooks |
| B6 | Tenancy/RBAC absent | Single-owner product |
| B7 | Expressions are Handlebars strings compiled per run | Template-injection surface (S3); no expression language per spec |

### Not started at all
Agents · RAG · templates · marketplace · analytics · public API · SDKs · CLI · SSO · audit logs · quotas · self-hosting · response caching · model routing/fallback · schedule triggers · workflow versioning/publish.

---

## 5. Known defects & security findings

| ID | Severity | Finding | Location |
|---|---|---|---|
| S1 | **Critical** | ~~Stripe webhook accepts unsigned POSTs with arbitrary `workflowId`~~ **RESOLVED 2026-08-24** — per-workflow `webhookSecret` + Stripe signature verification (`AF-A-01`); migration `20260822030000` | `src/app/api/webhooks/{stripe,google-form}/route.ts`, `src/lib/secure-compare.ts` |
| S2 | High | Credentials encrypted with Cryptr (AES-CBC); **partially addressed 2026-08-24**: boot-time env validation + lazy key via `src/lib/env.ts`; CBC→AEAD upgrade deferred to M3 crypto module | `src/lib/encryption.ts`, `src/lib/env.ts` |
| S3 | High | User-supplied endpoint/body strings passed through `Handlebars.compile` at runtime — template-injection surface; also no SSRF guard or timeout on outbound HTTP | `http-request/executor.ts:67–81` |
| S4 | Medium | Save input uses `z.record(z.string(), z.any())` — node config never validated against a schema | `workflows/server/routers.ts:62` |
| S5 | Medium | Fake tRPC context `{ userId: 'user_123' }` still exported (inert but a latent authz trap) | `src/trpc/init.ts:11` |
| D7 | Medium | `NodeType` Postgres enum — new node type requires a migration | `prisma/schema.prisma:96` |
| D9 | Low | Sentry example routes still present | `src/app/sentry-example-page/`, `src/app/api/sentry-example-api/` |
| D11 | Low | README is create-next-app boilerplate; root `/` 404s | `README.md` |
| D12 | Low | ~~303 Biome errors / 71 warnings~~ **RESOLVED 2026-08-24** — `npm run lint` exits clean; CI gate added (`AF-A-06`) | repo-wide |
| D13 | Low | Raw `console.error` in webhooks — **logger part RESOLVED 2026-08-24** (`src/lib/logger.ts` w/ redaction + Sentry `beforeSend`); `.env.example` created; still no local `.env` in this checkout (app cannot boot without provisioning) | `webhooks/*/route.ts`, `.env.example` |
| D14 | Low | Dev retries=0 vs prod retries=3 hides failure paths locally; error stack stored raw on `Execution.error` — **RESOLVED 2026-08-24** (`ENGINE_RETRIES` constant + 8 KB stack truncation, `AF-A-07`) | `src/inngest/config.ts` |
| D15 | Medium | **Found & fixed 2026-08-24:** `toposort@2.0.2` throws "Cyclic dependency" on self-edges; the old `topologicalSort` added a self-edge per disconnected node, so any workflow with ≥1 connection AND ≥1 isolated node failed to execute with a false cycle error. Fixed by appending unconnected nodes after the sorted set + mapping toposort errors to the domain message; covered by unit tests | `src/inngest/utils.ts` |

Resolved by audit (were previously mis-tracked): D1 save no-op (**never existed** — save works), D4 swallowed prefetch errors (**not present** — grep clean).

---

## 6. Milestone tracker

| # | Milestone | Status | Notes |
|---|---|---|---|
| M-A | Audit hardening (new) | ✅ Done — 2026-08-24 | Waves 1+2: S1 closed, SSRF guard, template-injection decision (ADR-0007), save-boundary Zod validation, per-node traces (AF-A-01..07). |
| M0 | Stabilize the base | 🟠 Mostly done | M0-00/01/05/06/07/08/02/03/04/09 ✅ (M0-06 Testing Library done 2026-08-24; only DB-backed integration tests remain, blocked on live DB). |
| M1 | Graph persistence + Node SDK | ⬜ Not started | Save already works (AF-M1-04 partially satisfied); registry/enum-drop/palette/config-panel outstanding. |
| M2 | Execution engine + traces | 🟠 Partially pre-built | Tutorial engine exists (topo sort, step.run, realtime); traces/branching/compiler/expression-resolver per spec do not. |
| M3 | Credential vault + connectors | 🟠 Partially pre-built | Basic CRUD + Cryptr exist; envelope crypto/OAuth refresh/connector framework do not. |
| M4 | Triggers, publish, versioning | ⬜ Not started | Webhook triggers exist but unauthenticated; no cron/versioning. |
| M5–M8 | As planned | ⬜ Not started | AI cost layer, tenancy, templates, beta hardening. |

---

## 7. Metrics baseline

| Metric | Value | Source |
|---|---|---|
| Source files (`src/**` ts/tsx) | 197 | file listing |
| Prisma models | 10 (`User`, `Session`, `Account`, `Verification`, `Credential`, `Workflow`, `Node`, `Connection`, `Execution`, `NodeExecution`) | `schema.prisma` |
| tRPC routers | 3 (`workflows`, `executions`, `credentials`) | `src/trpc/routers/_app.ts` |
| Executable node types | 10 | `executor-registry.ts` |
| Inngest functions | 1 (`execute-workflow`) + 9 realtime channels | `src/inngest/functions.ts` |
| Tests | **81 passing** (9 files: inngest utils/trace, logger, secure-compare, engine config, egress-guard, workflow schemas, template, upgrade-modal DOM) | `npm test` |
| CI pipelines | 1 (`.github/workflows/ci.yml`: lint + tsc + test + build on postgres:16) | repo root |
| Type check | ✅ clean after `npx prisma generate` | `tsc --noEmit` exit 0 |
| Lint | ✅ clean (`biome check` exits 0; vendored-UI overrides documented) | `biome check` |
| Migrations | 15 (latest `20260824100000` drops the dead tutorial `Post` table; `20260824090000` adds `NodeExecution` traces — both unapplied locally, CI applies via `migrate deploy`) | `prisma/migrations` |
| Connectors | Discord + Slack send nodes | `executor-registry.ts` |
| Templates | 0 | — |

---

## 8. Changelog

Newest first.

| Date | Change | Milestone |
|---|---|---|
| 2026-08-25 | **Setup manual.** `docs/operations/environment_setup.md` rewritten as a full operator's guide (env-var reference reconciled against `src/lib/env.ts` — fixed wrong required/optional claims, removed nonexistent vars GROQ_API_KEY/INNGEST_BASE_URL/TEST_DATABASE_URL rows, NEXT_PUBLIC_POLAR_PRODUCT_ID/SUCCESS_URL; step-by-step acquisition guides for Postgres/secret generation/GitHub+Google OAuth/Polar sandbox/Inngest Cloud keys/Stripe webhook secret/Sentry token/ngrok domain; local walkthrough + smoke test; ngrok internet-exposure flow; Vercel+Neon+Inngest Cloud deployment with the Polar `server:"sandbox"` hardcode called out as a go-live blocker). Stale references removed: `scripts/dev-db.ps1`, `test/db.ts`, `prisma:studio` script, ESLint->Biome. | docs |
| 2026-08-24 | **M0-06 Testing Library.** `@testing-library/react` + jsdom `dom` vitest project (`*.dom.test.{ts,tsx}`, jest-dom matchers); first component test `upgrade-modal.dom.test.tsx` (3 tests). Root-caused the long-standing "`@/` imports fail under Vitest" quirk: inline `test.projects` don't inherit root-level `resolve.alias` or `setupFiles` — both now declared per project in `vitest.config.ts`, unblocking `@/` runtime imports in all future tests (AGENTS.md §6 updated). Gates: 81/81 tests, tsc clean, biome clean. | M0 |
| 2026-08-25 | **Prisma 7 upgrade (6.16.3 → 7.9.1).** Schema datasource `url` removed (P1012 in v7) — connection URL moved to new `prisma.config.ts` (loads `.env` via `dotenv/config`; the v7 CLI no longer auto-loads `.env`). Generator swapped `prisma-client-js` → `prisma-client` (plain ESM TypeScript emitted to `src/generated/prisma`, no barrel index) and all `@/generated/prisma` imports repointed to `@/generated/prisma/client` across 18 files. Runtime now requires a driver adapter: `@prisma/adapter-pg` wired into `src/lib/db.ts` (`new PrismaClient({ adapter })`, URL via `ensureEnv()`). Verified: 15/15 migrations apply to dev DB, live query + enums OK, Turbopack boot OK, tsc/biome clean, 78/78 tests. | infra |
| 2026-08-24 | **M0 cleanup wave.** AF-M0-04: fabricated `userId` removed from tRPC context (`createTRPCContext` returns `{}`; identity only via `protectedProcedure`'s Better Auth session → `ctx.auth`; `baseProcedure` documented as unauthenticated/tenant-unsafe). AF-M0-09: real `README.md` (honest status, stack, quick start, gates), root `AGENTS.md` created (truth files, spec routing, hard rules, conventions, workflow), `docs/README.md` ADR index completed (0007). AF-M0-02: sentry example page/route deleted; migration `20260824100000_drop_post_table` drops the dead tutorial `Post` table from deployed DBs. AF-M0-03: Polar product ID/slug externalized (`POLAR_PRODUCT_ID`, `POLAR_PRODUCT_SLUG`, `NEXT_PUBLIC_POLAR_PRODUCT_SLUG` via `src/lib/env.ts`; empty products list when unset so the app boots without billing; client checkout buttons read `polarProductSlug`; `.env.example` updated). Gates after each commit: 78/78 tests, tsc clean, biome clean. Remaining M0: M0-06 Testing Library + docs sync (needs live DB for integration tests). | M0 |
| 2026-08-24 | **Hardening wave 2.** AF-A-02: SSRF egress guard (`egress-guard.ts` — scheme/host allowlist, private-IP + metadata-endpoint blocks, DNS-resolve check) + 30s timeout + response byte cap on http-request. AF-A-03: ADR-0007 — Handlebars runtime compilation kept, sandbox defaults pinned (`noEval`, prototype guards), `compileTemplate` wrapper; raw `Handlebars.compile` banned. AF-A-04: Zod v4 save-boundary validation (`saveWorkflowInputSchema`, discriminated union over the 10 node types; cuid2 node ids → length-bounded `nodeId()`); editor save filters untyped nodes; 9 schema tests. **AF-A-05: per-node execution traces** — additive `NodeExecution` model (migration `20260824090000`) with status/attempt/order/durationMs; engine writes `trace-start/end/fail:<nodeId>` steps around every executor plus bulk SKIPPED rows for unreached nodes; execution detail UI renders the ordered trace list; 5 helper unit tests (`src/inngest/trace.ts` kept free of generated-client runtime imports for Vitest). Gates: 78/78 tests, tsc clean, biome clean. M-A complete. Remaining M0: AF-M0-04 real auth ctx, AF-M0-09 README/AGENTS, M0-06 Testing Library remainder, M0-02/03. | M-A |
| 2026-08-24 | **Hardening wave 1.** AF-A-01: per-workflow `webhookSecret` (migration `20260822030000`) + Stripe signature verification; both webhook routes rewritten (400/404 semantics, `secureCompare`), trigger dialogs embed secret URLs. AF-M0-07: redacting structured logger + Sentry `beforeSend` redaction. AF-M0-08: Zod env validation at boot (`src/lib/env.ts`, `SKIP_ENV_VALIDATION=1` for CI). AF-A-06: lint debt cleared (303→0 errors), CI gate live. AF-A-07: single `ENGINE_RETRIES` retry policy + truncated error stacks. AF-M0-06: Vitest+Playwright+GitHub Actions harness, 16 unit tests. **D15 found & fixed:** toposort self-edge false-cycle bug. Remaining M-A: A-02 SSRF/timeout, A-03 template-injection decision, A-04 config validation, A-05 traces. | M-A / M0 |
| 2026-08-22 | **Docs↔code reconciliation.** Full audit of the repository against this doc set found the prior snapshot wrong in both directions: (a) claimed-missing capabilities that exist — Inngest execution engine w/ 10 executors, canvas save, executions/credentials UIs, google-form/stripe triggers; (b) claimed-shipped work that does not exist — test harness/CI, node SDK registry, enum drop, logger/env modules, dead-code cleanup. All M0/M1 "shipped" statuses reverted to todo; new milestone M-A opened for audit findings S1–S14. Versions corrected throughout (Next 15.5.4 / Prisma 6.16 / Inngest 3.44 / Biome — not 16/7/4.2/ESLint). Prior changelog rows below describe aspirational state and are retained only as history of intent. | — |
| *2026-08-21* | *Aspirational entry (enum drop, node registry) — not present in code.* | — |
| *2026-08-14* | *Aspirational entries (Node SDK scaffold, backend hygiene) — not present in code.* | — |
| *2026-08-07..08-02* | *Aspirational entries (dead-code removal, Polar externalization, env validation, pagination fix, test harness, docs set creation) — except docs-set creation itself, none are present in code. Pagination count is nonetheless correct in current code (pre-existing implementation).* | — |
| 2026-10→11 (actual git) | Tutorial lessons merged to `main` as PRs #17–#30: entity infra, dashboard/auth/billing, canvas, workflow CRUD, node templating, executions UI, credentials, HTTP node, OpenAI/Anthropic/Gemini/Discord/Slack nodes, google-form/stripe triggers, deployment wiring. This is the true provenance of everything in §3. | pre-M0 |

---

## 9. How to update this document

When you complete a task:

1. Move the item from §4 to §3 with a file-path evidence reference.
2. Close any defect in §5 that the change fixes; add any it introduces.
3. Update the §2 percentage for the affected PRD area — **only if the capability actually works end to end**, not if the code merely compiles.
4. Update the §6 milestone status.
5. Add a §8 changelog line.
6. If it is the end of a milestone, re-measure §7.

**Do not mark anything green that you have not personally exercised.** An honest progress document is the only thing standing between this project and a rebuild.
