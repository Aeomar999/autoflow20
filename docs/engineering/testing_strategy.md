# Testing Strategy

**Status:** Target strategy — **not yet implemented.** As of 2026-08-22 there are zero test files, no Vitest/Playwright configs, and no `.github/` workflows in this repo. Everything below describes what `AF-M0-06` will build. A previous revision claimed this was "Active" with shipped harness + CI + e2e journeys; the audit found none of it exists. Do not cite commands or files here as if they work until `AF-M0-06` lands.

---

## 1. What we optimize for

We are not chasing a coverage number. We are protecting four properties, because failures in these are the ones that lose customers:

1. **Correct execution.** A workflow does what its graph says, and its trace tells the truth about what happened.
2. **Tenant isolation.** No customer ever sees another customer's data.
3. **Credential secrecy.** Plaintext never leaves the runtime.
4. **No silent failure.** Errors surface; they do not become empty states or skipped branches.

Tests that protect these are mandatory. Tests that assert a button is blue are discouraged — they cost more in maintenance than they return.

---

## 2. The pyramid

```
        ╱ E2E ╲            few — critical journeys only (Playwright)
      ╱─────────╲
    ╱ Integration ╲        moderate — routers, DB, authz (Vitest + test DB)
  ╱─────────────────╲
╱       Unit         ╲     many — engine, nodes, crypto, expressions (Vitest)
```

| Level | Tool | Scope | Speed |
|---|---|---|---|
| Unit | Vitest | Pure functions; no DB, no network | < 1s total |
| Component | Vitest + Testing Library | Rendering + interaction, mocked data | seconds |
| Integration | Vitest + real Postgres | tRPC procedures, DB, transactions, authz | tens of seconds |
| E2E | Playwright | Full stack in a browser | minutes |

---

## 3. Mandatory coverage

Non-negotiable per `docs/engineering/engineering_rules.md` §11. A PR touching these areas without tests is rejected.

| Area | Required cases |
|---|---|
| **Engine — compile** | linear · branching · diamond · disconnected · cyclic · unknown node type · invalid config · missing trigger |
| **Engine — plan** | deterministic ordering for equivalent graphs · correct level assignment |
| **Engine — skip semantics** | condition true/false → untaken-branch nodes are `SKIPPED` with a reason, and **no node is absent from the trace** |
| **Engine — retry** | retryable retried to max · non-retryable single attempt · every attempt recorded · `continueOnFail` |
| **Engine — resume** | kill mid-run, resume, assert completed side effects are not repeated |
| **Engine — cancellation** | in-flight aborts · remainder `SKIPPED` · status `CANCELLED` |
| **Expressions** | nested paths · arrays · missing refs · malformed syntax · **injection attempt is inert** |
| **Node `execute`** | happy path · upstream API error · malformed config · zero input items (per node) |
| **Crypto** | round-trip · tampered ciphertext fails loudly · wrong key fails · key rotation |
| **Credential secrecy** | no procedure returns plaintext · plaintext absent from `NodeExecution` IO and from logs |
| **Tenant isolation** | org B cannot read or write org A's workflows, executions, or credentials via **any** procedure |
| **Roles** | each role × each mutating procedure — allowed or `FORBIDDEN` as specified |
| **Pagination** | `count` and page share filters (the `AF-M0-01` regression) |
| **Logger redaction** | nested secret, secret inside an array, secret in an error cause |
| **SSRF guard** | loopback · link-local · private ranges · redirect-to-blocked · DNS-resolves-to-blocked |

---

## 4. What not to test

- Prisma's or Zod's own behavior. Test *our* schemas and queries, not the library.
- Presentational components with no logic.
- Exact copy strings — they change; assert roles and behavior.
- Implementation details. A test that breaks on a rename with no behavior change is a liability.
- Third-party APIs in unit tests. Mock at the network boundary; verify contracts in a separate, quarantined, opt-in suite.

---

## 5. Structure and conventions

```
src/
├── engine/run.ts
├── engine/run.test.ts              ← unit tests live beside the code
├── nodes/http/request/execute.test.ts
└── features/workflows/server/routers.integration.test.ts
test/
├── setup.ts                        ← global setup
├── db.ts                           ← test DB lifecycle + truncation
├── factories.ts                    ← makeUser, makeOrg, makeWorkflow, makeExecution
├── node-context.ts                 ← makeCtx() for node execute tests
└── e2e/                            ← Playwright specs
```

- Naming: `*.test.ts` (unit/component), `*.integration.test.ts` (needs a DB), `e2e/*.spec.ts`.
- Structure tests as arrange → act → assert with a blank line between; no shared mutable state between tests.
- Test names state the behavior: `"skips the false branch and records a reason"`, not `"test condition 2"`.
- Factories over fixtures. Every factory takes overrides and produces valid data by default.

---

## 6. Integration tests and the database

**Status (2026-08-26, AF-M0-06): implemented.** The `integration` vitest
project (`tests/integration/**`) runs against a real Postgres.

- A real Postgres (Docker or a dedicated test DB), never SQLite. Behavior differences (JSON operators, transactions, enums, `mode: "insensitive"`) would make the tests lie.
- Truncate between tests; do not re-run migrations per test.

### 6.1 The contract

| Piece | Rule |
|---|---|
| `TEST_DATABASE_URL` | Set it and the integration suites run; leave it unset and they **skip visibly** (`describe.skipIf`). Never fake green. |
| Safety | `vitest.integration.setup.ts` force-overwrites `DATABASE_URL` with `TEST_DATABASE_URL` **before any module imports**, so the Prisma client can never bind to your dev/prod database from `.env`. |
| Migrations | Applied once per suite in `beforeAll` via `npx prisma migrate deploy` (child env points at the test DB; dotenv does not override an explicitly passed var). |
| Truncation | `beforeEach` truncates all tables. Physical names follow schema `@@map`: `user`, `session`, `account`, `verification` are lowercase; `Workflow`, `Node`, `Connection`, `Execution`, `NodeExecution`, `Credential` are PascalCase. Quoted SQL identifiers are case-sensitive — this bit us once (D15-style lesson). |
| External boundaries | Inngest dispatch is mocked per-file (`vi.mock("@/inngest/utils")`) and asserted by call, not performed. |

### 6.2 Local recipe

```powershell
npm run test:db:up    # docker: postgres:16 → localhost:5433 (container autoflow-test-db)
$env:TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5433/autoflow_test"
npm run test:integration   # or: npx vitest run --project integration
npm run test:db:down
```

> **Windows gotcha (real incident):** use **`127.0.0.1`, never `localhost`.**
> Anything listening on `[::1]:5433` (e.g. `wslrelay.exe` relaying a WSL
> Postgres) wins IPv6-first resolution, and you silently test against a
> foreign empty database while `docker exec psql` shows perfectly good tables
> in the container. Symptom: `relation "credential" does not exist` despite a
> healthy-looking `\dt`.

CI provisions its own `postgres:16` service and applies migrations before the
suite (§8); no Dockerfile changes needed there.
- Wrap in a transaction and roll back where it is practical.
- Run serially if they contend; correctness beats wall-clock.

```ts
describe("workflows.saveGraph", () => {
  it("rejects a stale revision without writing", async () => {
    const { org, user } = await factories.orgWithUser();
    const wf = await factories.workflow({ organizationId: org.id, revision: 3 });
    const caller = createCaller({ user, org });

    await expect(
      caller.workflows.saveGraph({ workflowId: wf.id, nodes: [], edges: [], revision: 2 })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await prisma.workflow.findUniqueOrThrow({ where: { id: wf.id } });
    expect(after.revision).toBe(3);   // proves nothing was written
  });
});
```

---

## 7. E2E journeys

Keep this list short and green. A flaky E2E suite gets ignored, and an ignored suite is worse than none.

| # | Journey | Target milestone |
|---|---|---|
| 1 | Sign up → land on `/workflows` | M0 |
| 2 | Create workflow → add 3 nodes → configure → refresh → state preserved | M1 |
| 3 | Run a branching workflow with a deliberate failure → trace shows every node with correct status | M2 (needs `AF-A-05` traces) |
| 4 | Add a credential → use it in a node → run → succeed, with no plaintext anywhere in the page | M3 |
| 5 | Publish → fire the webhook → execution appears | M4 |
| 6 | Install a template → fill a credential → successful run | M7 |

Rules: no arbitrary sleeps (wait on conditions); deterministic seed data per spec; every spec cleans up after itself; a quarantined flaky test is fixed or deleted within a week.

---

## 8. CI

**Live since AF-M0-06** (`.github/workflows/ci.yml`): `postgres:16` service +
`npm ci` → `prisma generate` → `migrate deploy` → tsc → biome → vitest →
build, on push/PR. All steps required.

Current state vs this spec:

- The workflow sets `DATABASE_URL` to its own service DB and applies
  migrations — so CI can also run the **integration project** by exporting
  `TEST_DATABASE_URL=$DATABASE_URL` before `npm test`. *(Pending: wire that
  line in — locally verified recipe is §6.2; the suites skip on CI until
  then, visibly.)*
- Playwright e2e remains gated behind `E2E_SERVER`/`E2E_BASE_URL` (signup
  journey needs a reachable Polar sandbox per the note below).

### E2E operational notes

- **Use `localhost`, never `127.0.0.1`.** Next.js dev-mode can block hydration bootstrap from cross-origin hosts; Playwright `baseURL` and `webServer.url` must be `http://localhost:3000`.
- **Signup emails must be deliverable-looking.** Billing providers may validate email domains and reject reserved TLDs (`example.com`). Use a real-looking domain; the test only checks the redirect, never the inbox.

---

## 9. Bug protocol

**[HARD]** Every bug fix ships with a regression test that fails before the fix and passes after. Verify the failure first — a test that passes against the unfixed code is testing nothing.

Name it after the defect: `"AF-M0-01: count respects the search filter"`.

---

## 10. Definition of tested

Before marking a task done:

- [ ] Every mandatory case in §3 for the touched area has a test
- [ ] Tests fail if the implementation is reverted (spot-check at least one)
- [ ] No `.only`, no `.skip`, no commented-out tests
- [ ] No arbitrary `sleep`/`setTimeout` used to make timing work
- [ ] Integration tests clean up; the suite is order-independent
- [ ] CI green
