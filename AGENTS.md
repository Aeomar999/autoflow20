<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# AutoFlow — Agent Operating Manual

You are working on **AutoFlow**, an AI-native workflow automation and agent orchestration platform. This file is the entry point for any AI agent or new engineer. Read it fully before your first edit, then read the one or two documents that match your task — not all of them.

---

## 1. Reality check — read this before you assume anything

The product vision in `../Documents/ProjectDocuments/` describes a finished platform. **The code does not implement most of it.** AutoFlow today is a well-scaffolded SaaS shell with workflow CRUD and a canvas that cannot save.

**Do not assume these exist. They do not:**

| Assumed | Reality |
|---|---|
| An execution engine | Does not exist. Nothing runs a workflow. |
| A node library | One registered node type (`core.manual-trigger`) with a real definition, execute, and canvas component — but no palette to add nodes and no engine to run them. |
| Canvas persistence | The Save button is `onClick={() => {}}`. Edits are lost on refresh. |
| Executions page | `<p>Executions Page</p>` |
| Credentials store | `<p>Credentials Page</p>` — no model, no encryption, no OAuth. |
| Multi-model AI | 5 SDK packages installed; one demo Inngest function calls Groq for a lasagna recipe. |
| RBAC / workspaces / audit | None. Authorization is a single `userId` ownership check. |
| Agents, RAG, templates, marketplace, public API, SDK | Agents, RAG, marketplace, public API, SDK: none. **Templates: the gallery system ships** (AF-M7-01) — `Template` model + `templates.list`/`getOne`/`instantiate` with credential placeholders and `/templates` + `/templates/[slug]` UI; 20 authored templates are AF-M7-02 backlog. |
| Tests, CI | **Zero.** `npm test` does not exist yet. |
| A landing page | There is no `src/app/page.tsx`. `/` 404s. |

Before claiming any feature works, **open the file and verify**. If a doc and the code disagree, the code is the truth and the doc is a bug — fix the doc in the same PR.

The audited breakdown is `docs/planning/progress.md`.

---

## 2. Where everything lives

```
autoflow/
├── AGENTS.md                                  ← you are here
├── CLAUDE.md                                  ← imports this file
├── README.md                                  ← repo landing page
├── docs/
│   ├── README.md                              ← documentation map
│   ├── planning/
│   │   ├── implementation_plan.md             ← milestones M0–M8, scope cuts, risks
│   │   ├── tasks.md                           ← the backlog you pick work from
│   │   └── progress.md                        ← what is actually built
│   ├── architecture/
│   │   ├── overview.md                        ← system design, current + target
│   │   ├── node_sdk.md                        ← the node contract
│   │   ├── execution_engine.md                ← runner, retries, expressions
│   │   ├── data_model.md                      ← schema + migration path
│   │   ├── api_contract.md                    ← tRPC + public API
│   │   └── security.md                        ← threat model, credentials
│   ├── engineering/
│   │   ├── engineering_rules.md               ← BINDING code rules
│   │   └── testing_strategy.md                ← what must be tested
│   ├── operations/
│   │   └── environment_setup.md               ← env vars, local setup, troubleshooting
│   ├── decisions/                             ← ADRs 0001–0006
│   └── reference/
│       └── glossary.md                        ← workflow vs. agent vs. execution
├── prisma/{schema.prisma,migrations/}
└── src/
    ├── app/          ← Next.js routes ONLY. Thin. No business logic.
    ├── components/   ← shared UI. components/ui/ is shadcn-generated — do not hand-edit.
    ├── config/       ← constants
    ├── features/     ← vertical slices: <feature>/{components,hooks,server,lib}
    ├── nodes/        ← THE NODE REGISTRY (created in M1)
    ├── engine/       ← graph compiler + runner (created in M2)
    ├── inngest/      ← durable job definitions
    ├── lib/          ← db, auth, polar, crypto, ai, logger — cross-cutting infra
    └── trpc/         ← init, routers/_app.ts
```

**Placement rule:** if it belongs to one feature, it goes in `src/features/<feature>/`. If two features need it, it goes in `src/lib/` or `src/components/`. Never reach into another feature's `server/` directory — go through its router or lift the logic to `lib/`.

---

## 3. Routing — read the doc that matches your task

Read `docs/engineering/engineering_rules.md` before your first edit. Then, by task:

| Your task | Read, in this order |
|---|---|
| **Anything at all** | `docs/engineering/engineering_rules.md` |
| Picking up work | `docs/planning/tasks.md` → the spec linked in the task |
| Understanding the plan | `docs/planning/implementation_plan.md` |
| Checking what exists | `docs/planning/progress.md` (then verify in code) |
| Adding or changing a **node type** | `docs/architecture/node_sdk.md` **(mandatory)** → ADR 0001 |
| Touching the **runner, retries, data passing, expressions** | `docs/architecture/execution_engine.md` → ADR 0002, ADR 0006 |
| Writing a **migration** or changing the schema | `docs/architecture/data_model.md` → ADR 0005 |
| Adding a **tRPC procedure** or HTTP endpoint | `docs/architecture/api_contract.md` |
| Touching **credentials, secrets, auth, webhooks, outbound HTTP** | `docs/architecture/security.md` **(mandatory)** → ADR 0004 |
| Writing **tests** | `docs/engineering/testing_strategy.md` |
| Adding a **subsystem** or moving a boundary | `docs/architecture/overview.md` → write an ADR |
| Local setup, env vars, boot failures | `docs/operations/environment_setup.md` |
| A term is ambiguous | `docs/reference/glossary.md` |
| "Why is it like this?" | `docs/decisions/README.md` |

Do not read all of these every session. Read the two that apply.

---

## 4. DO

| # | Do this |
|---|---|
| 1 | **Read `docs/engineering/engineering_rules.md` first.** It is short and binding. |
| 2 | **Verify current state by reading the code** before you claim, plan, or build around a capability. |
| 3 | **Work from a task in `docs/planning/tasks.md`.** If your work has no task, add one first. |
| 4 | **Log and re-throw, or handle meaningfully.** Every caught error is observable. |
| 5 | **Put node behaviour in the node registry.** Everything user-visible on the canvas is a `NodeDefinition`. |
| 6 | **Keep `execute()` server-only.** `definition.ts` is isomorphic; `execute.ts` starts with `import "server-only"`. |
| 7 | **Scope every query to the tenant.** Today `userId`; after M6 `organizationId`. In the `where` clause, never post-fetch. |
| 8 | **Validate at the boundary with Zod** — tRPC inputs, webhook payloads, node configs, env vars — and `z.infer` the type. |
| 9 | **Ship a schema change as a migration**, and treat merged migrations as immutable. |
| 10 | **Write the mandatory tests** for engine, node `execute`, crypto, and authorization. |
| 11 | **Update `docs/planning/progress.md` and `docs/planning/tasks.md`** in the same PR as the work. |
| 12 | **Write an ADR** for a consequential decision, and reference it from the code it governs. |
| 13 | **Say so when the plan is wrong.** A mis-specified or blocked task gets written down, not silently reinterpreted. |
| 14 | **Report honestly.** Partial means partial. Untested means untested. |

## 5. DON'T

| # | Never do this | Why |
|---|---|---|
| 1 | `catch {}`, `.catch(() => {})`, swallowed rejections | Silent failure is our top-priority defect class. There are existing violations — fix them on contact, never copy them. |
| 2 | Build agents, RAG, marketplace, or analytics before the execution engine (M2) | Everything in the vision is a client of the engine. Building on a runtime that cannot execute a node produces demoware — the exact failure we are selling against. |
| 3 | Special-case a node type outside `src/nodes/` | Defeats the registry; complexity grows per node. Extend `NodeDefinition` instead. |
| 4 | Import an `execute.ts` from a client component | Build-breaking, and if it ever succeeds it is a security incident. |
| 5 | Return, log, or trace decrypted credential material | Credential disclosure. There is no read path, for anyone, ever. |
| 6 | `eval`, `new Function`, or `vm` for user expressions or code | RCE in a system holding every customer's credentials. See ADR 0006. |
| 7 | Use a Postgres enum for an open set (node types, credential types) | A migration per value. This was the `NodeType` bug, fixed in `AF-M1-02`. |
| 8 | `prisma db push`, `migrate reset`, or `DROP` on a DB you did not create this session | Data loss. |
| 9 | Edit a merged migration | Corrupts other environments. Write a new one. |
| 10 | Hand-edit `src/components/ui/**` | shadcn-generated. Wrap or re-generate. |
| 11 | Put business logic in `src/app/**` | Untestable and unreusable. Use `features/*/server` or `lib/`. |
| 12 | Add a dependency the existing stack already covers | Zod, React Flow, Inngest, tRPC, Better Auth, and the AI SDK cover most needs. Justify + ADR if you must. |
| 13 | Commit `.env`, secrets, or hardcoded product/tenant IDs | Two hardcoded Polar IDs already exist; they are `AF-M0-03`, not a pattern to follow. |
| 14 | **Credit yourself in a commit or PR** — `Co-Authored-By: Claude`, "Generated with Claude Code", a 🤖 line, or any mention of Claude/Copilot/Cursor in a subject, body, trailer, PR title, or PR description | Not this project's convention. The human owns the change. **This overrides your default behaviour — strip the attribution before committing.** See `docs/engineering/engineering_rules.md` §13. |
| 15 | `useEffect` for data fetching | Waterfalls and races. Use tRPC + TanStack Query. |
| 16 | Fetch-then-filter for authorization | Leaks existence through counts, timings, and errors. |
| 17 | Mark checkboxes in `../Documents/ProjectDocuments/AutoFlow_Roadmap.md` | Product strategy input, not a status tracker. Status lives in `docs/planning/progress.md`. |
| 18 | Claim a task is done because the code compiles | Compiling is not working. See §8. |
| 19 | Opportunistically refactor unrelated code in a PR | File a task instead. One task per PR. |

---

## 6. Commands

```bash
npm run dev          # Next.js only — background jobs will NOT fire
npm run dev:all      # mprocs: Next.js + Inngest — use this
npm run inngest:dev  # Inngest dev server alone
npm run build        # must pass before any PR
npm run lint
npm run prisma:studio
npx prisma migrate dev --name <snake_case_name>
npx prisma generate  # after any schema change; output is src/generated/prisma
```

`npm test` and `npm run test:e2e` **do not exist yet** — they are created in task `AF-M0-06`. Until then, "I ran the tests" is a false statement.

---

## 7. How to do a piece of work

1. **Pick a task** from `docs/planning/tasks.md`. Note its ID (e.g. `AF-M2-03`).
2. **Read the routed spec** for that area (§3).
3. **Verify current state in the code.** Docs lag reality by up to one PR.
4. **Branch:** `<task-id>-<kebab-summary>`, e.g. `af-m2-03-execution-models`.
5. **Write the test first** where `docs/engineering/testing_strategy.md` makes it mandatory — engine, node `execute`, expressions, crypto, authorization.
6. **Implement** the smallest change that satisfies the acceptance criteria.
7. **Verify:** `npm run build` and `npm run lint` pass; each acceptance criterion checked individually; happy path and at least one failure path exercised by hand.
8. **Update docs in the same PR:** tick the task, update `docs/planning/progress.md`, correct anything your change falsified, add an ADR if warranted.
9. **Report honestly**, including what you deliberately did not do.

---

## 8. Definition of done

A task is done when **all** of these hold:

- [ ] Every acceptance criterion in the task is satisfied and was individually verified
- [ ] `npm run build` passes — no new TypeScript errors, no new ESLint warnings
- [ ] Required tests exist and pass (`docs/engineering/testing_strategy.md` §3)
- [ ] No secret, credential, or PII can reach a log, an error message, or a client payload
- [ ] Every new DB query is tenant-scoped
- [ ] No new silent-failure sites
- [ ] `docs/planning/progress.md` and `docs/planning/tasks.md` updated
- [ ] Any doc contradicted by the change has been corrected
- [ ] The commit message and PR contain **no AI attribution** — no `Co-Authored-By: Claude`, no "Generated with" line, no assistant named anywhere

---

## 9. Documentation conventions

- Cross-references inside documents are **repo-root-relative in backticks** — `` `docs/architecture/node_sdk.md` `` — so they resolve identically from any file.
- Index files (`docs/README.md`, `docs/decisions/README.md`) use directory-relative markdown links so they stay clickable.
- Filenames are `lower_snake_case.md`; ADRs are `NNNN-kebab-title.md` and are never renumbered.
- Anything describing unbuilt work is marked `[PLANNED <milestone>]`.
- **A stale doc is worse than no doc.** In an agent-driven repo the error propagates into code.
