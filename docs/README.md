# AutoFlow Documentation

Everything under `docs/` is organised by **what you are doing**, not by what it is about.

```
autoflow/
├── AGENTS.md                 ← start here, always
├── CLAUDE.md                 ← imports AGENTS.md
├── README.md                 ← repo landing page
└── docs/
    ├── README.md             ← you are here
    ├── planning/             ← what we are building, in what order, and what is done
    ├── architecture/         ← how the system is designed
    ├── engineering/          ← how we write and verify code
    ├── operations/           ← how we run it
    ├── decisions/            ← why it is the way it is (ADRs)
    └── reference/            ← lookups
```

---

## planning/ — what and when

| Document | Read it when |
|---|---|
| [`planning/implementation_plan.md`](planning/implementation_plan.md) | You need the milestone map, the scope cuts, sequencing, or the risk register. |
| [`planning/tasks.md`](planning/tasks.md) | You are picking up work. Every task has an ID and acceptance criteria. |
| [`planning/progress.md`](planning/progress.md) | You need to know what is **actually** built. Update it when you finish. |

## architecture/ — how it is designed

| Document | Read it when |
|---|---|
| [`architecture/overview.md`](architecture/overview.md) | Adding a subsystem or moving a boundary. Start here for any design question. |
| [`architecture/node_sdk.md`](architecture/node_sdk.md) | Adding or changing a node type. **Required reading for node work.** |
| [`architecture/execution_engine.md`](architecture/execution_engine.md) | Touching the runner, retries, data passing, or expressions. |
| [`architecture/data_model.md`](architecture/data_model.md) | Writing a migration. |
| [`architecture/api_contract.md`](architecture/api_contract.md) | Adding a tRPC procedure or an HTTP endpoint. |
| [`architecture/security.md`](architecture/security.md) | Touching credentials, secrets, auth, webhooks, or outbound HTTP. |

## engineering/ — how we work

| Document | Read it when |
|---|---|
| [`engineering/engineering_rules.md`](engineering/engineering_rules.md) | **Before writing any code.** Binding rules. |
| [`engineering/testing_strategy.md`](engineering/testing_strategy.md) | Writing tests — which is most of the time. |

## operations/ — how we run it

| Document | Read it when |
|---|---|
| [`operations/environment_setup.md`](operations/environment_setup.md) | Local setup, env vars, or a boot failure. |
| [`operations/runbooks.md`](operations/runbooks.md) | You are on call, or an incident is happening. Five failure modes, symptom first. |
| [`operations/slos.md`](operations/slos.md) | Setting or arguing about reliability targets, error budgets, or what should alert. |
| [`operations/beta_launch_checklist.md`](operations/beta_launch_checklist.md) | Deciding whether the service can be opened to external users. Names four blockers. |
| [`operations/support.md`](operations/support.md) | Answering a customer, or deciding whether a report is an incident. |

## decisions/ — why

[`decisions/README.md`](decisions/README.md) explains the format and when to write one.

| # | Decision |
|---|---|
| [0001](decisions/0001-node-registry-as-core-abstraction.md) | Node registry as the core abstraction |
| [0002](decisions/0002-inngest-as-execution-runtime.md) | Inngest as the durable execution runtime |
| [0003](decisions/0003-phase-1-scope-cut.md) | Phase 1 scope cut |
| [0004](decisions/0004-credential-envelope-encryption.md) | Envelope encryption for credentials |
| [0005](decisions/0005-tenancy-timing.md) | Introduce tenancy at M6, not later |
| [0006](decisions/0006-expressions-not-eval.md) | Expressions are parsed, not evaluated |
| [0007](decisions/0007-handlebars-runtime-compilation.md) | Handlebars runtime compilation kept, sandboxed |

## reference/ — lookups

| Document | Read it when |
|---|---|
| [`reference/glossary.md`](reference/glossary.md) | A term is ambiguous — workflow vs. agent, execution vs. run, secret vs. config. |

---

## Product source material (outside this repo)

Strategy and PRD documents live at `../../Documents/ProjectDocuments/`:
`Autoflow_PRD.md` · `AutoFlow_Roadmap.md` · `AutoFlow_Gaps_Analysis.md` · `AutoFlow_Tactics.md` · `AutoFlow_Executive_Summary.md` · `AutoFlow_Sales_Playbook.md` · `AutoFlow_Quick_Reference.md`

Three cautions:

1. **They describe product intent, not current behaviour.** `planning/progress.md` is the truth about what exists.
2. **They contradict each other on Phase 1 scope.** The reconciliation is `planning/implementation_plan.md` §2 and ADR [0003](decisions/0003-phase-1-scope-cut.md).
3. **`AutoFlow_Roadmap.md` is not a status tracker.** Its unchecked boxes mean nothing, its ✅ marks are priority labels. Do not edit that file.

---

## Documents to add later

| Path | Milestone |
|---|---|
| ~~`reference/nodes/<node>.md` — per-node config reference~~ — **superseded** by the in-app reference at `/docs/nodes` (AF-M8-09), rendered from the node registry so it cannot drift; a checked-in file per node would be stale the first time a config field changed | one per node, from M1 |
| `operations/deployment.md` — production topology and release process | M8 |
| ~~`operations/runbooks/` — incident procedures (credential exposure is mandatory)~~ — **built** as [`operations/runbooks.md`](operations/runbooks.md) (AF-M8-07); credential exposure is F3 | M8 |
| `reference/rest-v1.md` — public API reference | M8 |
| ~~`operations/support.md` — triage and escalation~~ — **built** (AF-M8-10) | Beta |

---

## Path conventions

- Inside a document, cross-references are written **repo-root-relative** in backticks — `` `docs/architecture/node_sdk.md` `` — so they resolve the same no matter which file you are reading.
- Markdown links in index files (this file, `decisions/README.md`) are directory-relative so they stay clickable.
- Filenames are `lower_snake_case.md`. ADRs are `NNNN-kebab-title.md` and are never renumbered.

## Keeping documentation honest

**A stale document is worse than no document** — it is actively misleading, and in a repo worked by AI agents that error propagates into code.

- Code contradicts a doc → fix the doc in the same PR.
- Consequential decision → write an ADR.
- Task finished → update `planning/progress.md` and `planning/tasks.md`.
- Describing something unbuilt → mark it `[PLANNED <milestone>]`, as the existing docs do.
