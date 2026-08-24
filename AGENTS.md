# AGENTS.md

Working agreement for humans and AI agents contributing to AutoFlow.
Read this file **before starting any task**, then the spec routed in §3 for your area.

## 1. What this repo is

AutoFlow: a visual automation platform (Next.js 15 + tRPC + Prisma/Postgres +
Inngest). Users draw node graphs; Inngest executes them durably, node by node.
Pre-beta. The codebase is ahead of the docs in some places and behind in others -
only the planning files (§2) tell you which.

## 2. Truth files

- `docs/planning/tasks.md` - the backlog. Every task has an ID and acceptance
  criteria. Pick work from here in milestone order unless told otherwise.
- `docs/planning/progress.md` - what is *actually* built. Update both files in
  the same PR that completes the task. A stale doc is worse than no doc.

## 3. Spec routing

Read the relevant spec before writing code:

| You are touching... | Read first |
|---|---|
| Anything (first time) | `docs/architecture/overview.md` |
| A node type | `docs/architecture/node_sdk.md` |
| The execution engine / retries / data passing | `docs/architecture/execution_engine.md` |
| Prisma schema / migrations | `docs/architecture/data_model.md` |
| tRPC procedures or HTTP endpoints | `docs/architecture/api_contract.md` |
| Credentials, secrets, auth, webhooks, outbound HTTP | `docs/architecture/security.md` |
| Tests | `docs/engineering/testing_strategy.md` |
| Env vars / boot failures | `docs/operations/environment_setup.md` |

## 4. Hard rules

`docs/engineering/engineering_rules.md` is binding. The eight [HARD] rules:
no silent failures; no secrets/PII in logs or client payloads; every tenant query
is tenant-scoped; executor code never reaches the client bundle; schema changes
ship as migrations and merged migrations are immutable; no `eval`/`new Function`
/`vm` on user-supplied strings; all external input is Zod-parsed at the boundary;
lint + build pass before any PR.

## 5. Commands

```bash
npm run dev            # app (Turbopack)
npm run dev:all        # app + Inngest dev server via mprocs/dotenv
npm run lint           # biome check (must exit 0)
npx tsc --noEmit       # type check (must exit 0)
npm test               # vitest run (all must pass)
npm run build          # production build
```

CI runs lint, tsc, tests, and build against Postgres 16 and applies migrations
with `migrate deploy`.

## 6. Conventions

- Zod v4 syntax (`z.string().min(1)`, discriminated unions need literal
  discriminators - keep variant tuples explicit).
- Node ids on the canvas are cuid2 strings from `@paralleldrive/cuid2`; validate
  with length bounds, not `.cuid()` (that is cuid v1 and rejects them).
- Vitest cannot resolve runtime imports of `@/generated/prisma` or other `@/`
  aliases at runtime - use relative paths for runtime imports; `import type`
  from `@/...` is fine.
- Handlebars templates go through `src/features/executions/template.ts`
  (`compileTemplate`), never raw `Handlebars.compile` (ADR-0007).
- Outbound HTTP goes through `src/features/executions/components/http-request/egress-guard.ts`.
- Consequential decisions get an ADR in `docs/decisions/` (format there).

## 7. How to do a piece of work

1. **Pick** a task from `docs/planning/tasks.md` (milestone order: M0 leftovers,
   then M1+). Announce it by editing nothing yet - just work on it.
2. **Read** this file, then the specs routed in §3 for every file you will touch.
3. **Implement** honoring §4 hard rules and §6 conventions. Prefer editing
   existing patterns over inventing new ones.
4. **Verify**: run all four gates in §5 locally. Do not open a PR red.
5. **Close the loop**: update `tasks.md` (mark done, check acceptance items,
   note residuals) and `progress.md` (changelog row + affected sections) in the
   same PR.
6. **Commit**: imperative subject referencing the task ID (e.g.
   `feat(executions): per-node execution traces (AF-A-05)`); one logical change
   per commit; never commit secrets or generated client output beyond what is
   already tracked.
