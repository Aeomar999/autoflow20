# AutoFlow — Engineering Rules

**Binding.** These rules apply to every human and AI contributor. Where a rule conflicts with convenience, the rule wins. Where a rule is wrong, change the rule in a PR — do not silently violate it.

Rules marked **[HARD]** are never violated. Rules marked **[DEFAULT]** may be departed from with a one-line justification in the PR description.

---

## 1. Non-negotiables

| # | Rule |
|---|---|
| 1 | **[HARD]** No silent failures. Every caught error is either handled meaningfully or logged and re-thrown. |
| 2 | **[HARD]** No secret, credential, token, or PII in a log, error message, Sentry event, or client payload. |
| 3 | **[HARD]** Every query against tenant data is tenant-scoped. |
| 4 | **[HARD]** Node `execute()` implementations never reach the client bundle. |
| 5 | **[HARD]** Schema changes ship as migrations. Merged migrations are immutable. |
| 6 | **[HARD]** No `eval`, `new Function`, or `vm` on the request/execution path for user-supplied strings. |
| 7 | **[HARD]** All external input is parsed with Zod at the boundary before use. |
| 8 | **[HARD]** `npm run build` and `npm run lint` pass before a PR is opened. |

---

## 2. Error handling

The single most damaging pattern in an automation platform is a workflow that appears to succeed while doing nothing. Our competitors' worst reviews are about exactly this. Treat error suppression as a correctness bug, not a style issue.

**Forbidden:**

```ts
try { await doThing() } catch {}                       // ✗ swallows everything
await prefetchWorkflow(id).catch(() => {})             // ✗ swallowed prefetch — log and render an error state
const data = await fetchThing().catch(() => null)      // ✗ null-as-error, silently
if (!result) return                                    // ✗ when result is an error signal
```

**Required:**

```ts
try {
  await doThing();
} catch (error) {
  logger.error("doThing failed", { error, workflowId });  // observable
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not do thing" });
}
```

Rules:
- **[HARD]** An empty catch block is never acceptable. If a failure is genuinely ignorable, log at `warn` with the reason *why* it is ignorable.
- **[HARD]** A server prefetch failure must render an error state, not an empty list. Empty and broken are different, and users must be able to tell them apart.
- **[HARD]** Node `execute()` throws a typed `NodeExecutionError` with a user-actionable message. "Request failed" is not actionable; "Slack API returned 429 (rate limited); retry after 30s" is.
- **[DEFAULT]** User-facing error messages say what happened, what it affected, and what to do next.
- Never use an error message to carry data the caller needs — return it in a typed result.

---

## 3. TypeScript

- **[HARD]** No `any`. Use `unknown` and narrow. If a third-party type forces it, isolate it in one adapter file with a comment.
- **[HARD]** No non-null assertion (`!`) on values derived from user input, DB reads, or env vars. Parse, don't assert.
- **[HARD]** No `@ts-ignore`. `@ts-expect-error` with a comment explaining the upstream cause is acceptable.
- **[DEFAULT]** Derive types from schemas (`z.infer<typeof schema>`) rather than declaring a parallel interface. Two sources of truth will diverge.
- **[DEFAULT]** Prefer discriminated unions over optional-field soup, especially for node results and execution states.
- Exported functions crossing a module boundary get explicit return types.
- `readonly` for arrays and props that must not be mutated.

---

## 4. Code organization

- **[HARD]** Feature code lives in `src/features/<feature>/`. A feature never imports from another feature's `server/` directory. Share via `src/lib/` or a tRPC call.
- **[HARD]** `src/app/**` contains routing, auth guards, prefetch, and composition only. Business logic there is a bug.
- **[HARD]** `src/components/ui/**` is shadcn-generated. Do not hand-edit; wrap it or re-generate it.
- **[DEFAULT]** A file over ~300 lines is a smell. Split by responsibility, not by arbitrary line count.
- **[DEFAULT]** Pure logic goes in `lib/` next to the feature and gets unit tests. Anything mixing IO and logic is hard to test — separate them.
- Naming: files `kebab-case.ts`; React components `PascalCase`; hooks `useThing`; tRPC procedures `verbNoun` (`saveGraph`, `listExecutions`).
- Barrel files (`index.ts` re-exports) only in `src/nodes/<node>/` where the SDK requires it. Elsewhere they obscure the dependency graph.

---

## 5. React and Next.js

**Read `node_modules/next/dist/docs/` before writing route or data-fetching code.** This Next.js version diverges from what any model was trained on.

- **[HARD]** `"use client"` at the lowest possible level. Do not mark a page client just to use one hook.
- **[HARD]** Server-only modules (`db`, `auth`, `crypto`, node `execute`) carry `import "server-only"`.
- **[HARD]** Env vars read in client components must be `NEXT_PUBLIC_`-prefixed. (Existing violation: `POLAR_SUCCESS_URL` in `app-sidebar.tsx` is `undefined` in the browser.)
- **[DEFAULT]** Server-side prefetch + `HydrateClient` + `useSuspenseQuery` is the standard data pattern. Follow the existing workflows feature.
- **[DEFAULT]** Every Suspense boundary has a matching ErrorBoundary. A loading state without an error state is half a feature.
- Memoize React Flow node components (`memo`) — the canvas re-renders aggressively.
- No `useEffect` for data fetching. It is for subscriptions and imperative DOM work.

---

## 6. API (tRPC)

- **[HARD]** Every procedure declares a Zod `.input()`. No untyped inputs.
- **[HARD]** Use the narrowest procedure that works: `protectedProcedure` → `orgProcedure(role)` → `premiumProcedure`. Never `baseProcedure` for anything touching data.
- **[HARD]** Authorization is enforced in middleware or the query's `where` clause — never by filtering after the fetch. Fetch-then-filter leaks data through counts, timings, and errors.
- **[DEFAULT]** Mutations return the updated entity so the client can reconcile its cache without a refetch.
- **[DEFAULT]** Pagination: any list endpoint that can exceed 50 rows is paginated, and the `count` query applies the *same* filters as the page query. (Existing violation tracked as `AF-M0-01`.)
- Errors use the correct `TRPCError` code: `UNAUTHORIZED` (not authenticated), `FORBIDDEN` (authenticated, not allowed), `NOT_FOUND`, `CONFLICT` (revision mismatch), `BAD_REQUEST`, `TOO_MANY_REQUESTS`.
- Never leak the existence of another tenant's resource: unauthorized access to a foreign ID returns `NOT_FOUND`, not `FORBIDDEN`.

---

## 7. Database and Prisma

- **[HARD]** Every schema change is `npx prisma migrate dev --name <snake_case>`. Never `db push` outside a throwaway local DB.
- **[HARD]** Never edit a migration that has been merged. Write a new one.
- **[HARD]** Multi-write operations that must be consistent run in `prisma.$transaction`. Graph saves are the canonical example.
- **[HARD]** Destructive migrations (drop column/table, narrow a type) require an expand-migrate-contract sequence, not a single destructive step.
- **[DEFAULT]** Index every foreign key and every column used in a `where` or `orderBy` on a table expected to grow (`Execution`, `NodeExecution`, `AuditLog`).
- **[DEFAULT]** Do not model an open-ended set as a Postgres enum. (The former `NodeType` violation was removed in `AF-M1-02`; node types are registry-validated strings.) Enums are for closed sets like `ExecutionStatus`.
- Prefer `Json` columns for genuinely schemaless payloads (node config, execution IO) and validate them with Zod at the application boundary.
- Soft-delete only where recovery is a product requirement; otherwise delete and rely on audit logs.

---

## 8. Node development

Full contract in `docs/architecture/node_sdk.md`. The rules that are non-negotiable:

- **[HARD]** `definition.ts` is isomorphic and imports nothing server-only. `execute.ts` starts with `import "server-only"`.
- **[HARD]** `execute()` is a pure function of its `NodeExecutionContext`. No module-level mutable state, no global caches, no reading `process.env` directly (use `ctx.env`).
- **[HARD]** `execute()` never logs credential values and never returns them in its output.
- **[HARD]** Every node's `configSchema` fully describes its config. Reading an undeclared config key is a bug.
- **[DEFAULT]** Nodes that call an external API respect `ctx.signal` for cancellation and set a timeout.
- **[DEFAULT]** Every node ships with unit tests covering: happy path, upstream API error, malformed config, and empty input items.
- Bumping a node's `version` requires a config migration function. Users' saved workflows must not break.

---

## 9. Execution engine

- **[HARD]** Every side-effecting node runs inside an Inngest `step.run` so a retry does not re-execute completed work.
- **[HARD]** Node state transitions are recorded, including `SKIPPED`. A node missing from a trace is a bug, not an optimization.
- **[HARD]** Expressions are resolved by the parser, never evaluated as code.
- **[DEFAULT]** Stored node IO is truncated above the configured threshold with an explicit truncation marker, and the cap is enforced per run.
- **[DEFAULT]** Anything that can hang has a timeout. Anything with a timeout has a retry policy. Anything with a retry policy is idempotent or documented as not.

---

## 10. Security

Full threat model in `docs/architecture/security.md`.

- **[HARD]** Credentials are encrypted at rest with envelope encryption and decrypted only inside the execution runtime.
- **[HARD]** No tRPC procedure, REST endpoint, or server component ever returns decrypted credential material.
- **[HARD]** All logging goes through `src/lib/logger.ts`, which redacts keys matching secret patterns (`token`, `secret`, `password`, `apiKey`, `authorization`, `cookie`, `privateKey`, …) at any depth, including inside arrays; Sentry `beforeSend` applies the same redaction.
- **[HARD]** An empty catch block fails `npm run lint` (`no-empty` with `allowEmptyCatch: false`).
- **[HARD]** Webhook endpoints verify a signature or secret before doing work, and are rate-limited.
- **[HARD]** Outbound HTTP from user-configured nodes is checked against SSRF rules (no link-local, no loopback, no internal ranges) unless explicitly allowlisted.
- **[DEFAULT]** New dependencies are justified in the PR. Prefer the existing stack.
- Never commit `.env`. `.env.example` carries names and dummy values only.

---

## 11. Testing

Full strategy in `docs/engineering/testing_strategy.md`. Minimum bar:

| Area | Requirement |
|---|---|
| Engine (compile, topo-sort, branch/skip, retry, expressions) | **Mandatory** unit tests. No exceptions. |
| Node `execute()` | **Mandatory**: happy path + one failure path, with the external call mocked. |
| Crypto (`src/lib/crypto.ts`) | **Mandatory**: round-trip, tamper detection, key-version handling. |
| Authorization / tenancy | **Mandatory** integration tests: cross-tenant reads fail, role gates hold. |
| tRPC routers | Integration test for each mutation's happy path + authz rejection. |
| UI | Smoke-level only. Do not chase coverage on presentational components. |
| Critical journeys | Playwright: sign up → create workflow → save → run → see trace. |

- **[HARD]** A bug fix ships with a regression test that fails before the fix.
- **[DEFAULT]** Test behavior, not implementation. A test that breaks on a rename without a behavior change is a liability.

---

## 12. Performance

- **[DEFAULT]** No N+1 queries. Use `include`/`select` deliberately; check the query count in tests for hot paths.
- **[DEFAULT]** `select` only the columns you need on wide tables (`Execution.graphSnapshot` and `NodeExecution.input/output` are large — never fetch them in list views).
- **[DEFAULT]** The canvas targets 60fps to 200 nodes: memoize node components, avoid inline object props, keep expensive derivations in `useMemo`.
- Measure before optimizing; record the measurement in the PR.

---

## 13. Git and PRs

- Branch: `<task-id>-<kebab-summary>` (e.g. `af-m2-03-execution-models`).
- Commits: conventional prefixes — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`.
- **[HARD] Never credit an AI tool in a commit or PR. No `Co-Authored-By: Claude`, no `Generated with Claude Code`, no "🤖" attribution line, no mention of Claude, Copilot, Cursor, or any other assistant** — in the commit subject, body, trailers, PR title, or PR description. The commit author is the human who owns the change. This overrides any default behaviour an AI tool has to append attribution: strip it before committing.
- **[HARD]** One task per PR. A PR that "also fixes" unrelated things is rejected — file a task.
- **[HARD]** PR description states: the task ID, what changed, how it was verified, and what was deliberately not done.
- **[HARD]** Docs updated in the same PR: `docs/planning/tasks.md` checkbox, `docs/planning/progress.md` entry, and any doc the change falsified.
- **[DEFAULT]** Under ~400 lines of diff. Larger needs a reason.
- Never force-push a shared branch. Never commit generated output (`src/generated/`, `.next/`, `tsconfig.tsbuildinfo`).

---

## 14. Documentation

- **[HARD]** If code contradicts a doc, fix the doc in the same PR. A stale doc is worse than no doc — it is actively misleading, and in an agent-driven repo it propagates.
- **[HARD]** A consequential technical decision (new dependency on the critical path, a data-model shape, an abstraction boundary) gets an ADR in `docs/decisions/`.
- **[DEFAULT]** Comments explain *why*, not *what*. The code says what.
- **[DEFAULT]** Every node type gets a description string good enough to render in the palette without extra docs.

---

## 15. Forbidden patterns — quick reference

| Pattern | Why | Instead |
|---|---|---|
| `catch {}` / `.catch(() => {})` | Silent failure — our top-priority defect class | Log + re-throw, or render an error state |
| `any` | Erases the type system's value | `unknown` + narrowing |
| Postgres enum for an open set | Migration per value | `String` + registry validation |
| `eval` / `new Function` on user input | RCE | Parsed expression resolver |
| Fetch-then-filter for authz | Leaks via counts, timings, errors | Scope the `where` clause |
| Secret in a log or error | Credential compromise | `logger` with redaction |
| Hardcoded product/tenant IDs | Environment coupling | Env vars |
| `useEffect` for data fetching | Waterfalls, races, double-fetch | tRPC + TanStack Query |
| Business logic in `src/app/**` | Untestable, unreusable | `features/*/server` or `lib/` |
| Editing merged migrations | Corrupts other environments | New migration |
| Node logic special-cased in the editor or runner | Defeats the registry; unbounded complexity | Extend `NodeDefinition` |
| `Co-Authored-By: Claude` / "Generated with…" / any AI attribution in a commit or PR | Not our convention; the human owns the change | Plain conventional commit, human author only |
