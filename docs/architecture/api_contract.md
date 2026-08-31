# API Contract

**Status:** Current tRPC surface + target internal and public APIs.
**Read before:** adding a procedure or an HTTP endpoint.

---

## 1. Surfaces

| Surface | Consumer | Stability | State |
|---|---|---|---|
| tRPC | Our own web app only | Internal — change freely with the client | **[BUILT]** (1 router) |
| Webhook ingress | External systems triggering workflows | Public — versioned by endpoint | **[PLANNED M4]** |
| REST v1 | External API clients | Public — semver, deprecation policy | **[PLANNED M8]** |
| Inngest events | Internal async | Internal | **[PARTIAL]** |
| GraphQL | External | — | Phase 3 |

**Rule:** tRPC is not a public API. It is coupled to our client and has no compatibility guarantee. External access goes through REST v1 with its own types and its own tests. Exposing tRPC publicly would freeze our internal refactoring ability permanently.

---

## 2. tRPC — procedure ladder

```
baseProcedure          unauthenticated. Must not touch tenant data.
  └─ protectedProcedure   requires a session
       └─ orgProcedure(role)   requires membership at ≥ role   [M6]
            └─ premiumProcedure   requires an active subscription
```

Rules:
- **[HARD]** Every procedure declares a Zod `.input()`.
- **[HARD]** Use the narrowest procedure that works. `baseProcedure` for anything reading data is a review rejection.
- **[HARD]** Tenant scoping in the `where` clause, never post-fetch.
- Mutations return the updated entity.
- List endpoints that can exceed 50 rows are paginated, and the `count` uses the identical `where` as the page query.

### Error codes

| Code | Use |
|---|---|
| `UNAUTHORIZED` | Not authenticated |
| `FORBIDDEN` | Authenticated, lacks role/subscription **for a resource they can see** |
| `NOT_FOUND` | Missing **or** belongs to another tenant (never disclose existence) |
| `BAD_REQUEST` | Validation failure — include field paths |
| `CONFLICT` | Optimistic-concurrency revision mismatch |
| `TOO_MANY_REQUESTS` | Rate limited |
| `INTERNAL_SERVER_ERROR` | Unexpected — generic message to the client, full detail to logs/Sentry |

Error messages returned to the client never contain SQL, stack traces, internal ids, or secrets.

---

## 3. Router map

### `workflows` — **[BUILT / EXTENDED M1–M4]**

| Procedure | Type | Auth | State |
|---|---|---|---|
| `create` | mutation | premium | ✅ |
| `getOne` | query | protected | ✅ returns `{ id, name, nodes[], edges[] }` |
| `getMany` | query | protected | ✅ paginated + search (count bug: `AF-M0-01`) |
| `updateName` | mutation | protected | ✅ |
| `remove` | mutation | protected | ✅ |
| `saveGraph` | mutation | org:EDITOR | M1 — `{ workflowId, nodes, edges, revision }` → `CONFLICT` on stale revision |
| `run` | mutation | org:EDITOR | M2 — creates an `Execution`, emits the event, returns `{ executionId }` |
| `publish` / `activate` / `deactivate` | mutation | org:EDITOR | M4 |
| `listVersions` / `rollback` | query / mutation | org:EDITOR | M4 |

### `nodes` — **[M1]**
`list` (query, protected) → the client-safe manifest: type, version, category, label, description, icon, keywords, ports, JSON-schema form of `configSchema`, credential requirements. Cacheable; changes only on deploy.

### `executions` — **[M2]**

| Procedure | Notes |
|---|---|
| `list` | filters: workflowId, status, dateRange, mode; paginated; **must not select `graphSnapshot`/`input`/`output`** |
| `getOne` | run + ordered node traces (large IO fetched here, truncation marked) |
| `cancel` | idempotent; no-op on terminal runs |
| `retry` | new execution from the same snapshot |
| `retryFromNode` | new execution reusing prior outputs up to that node |

### `credentials` — **[M3]** *(as built AF-M3-02)*
| Procedure | Notes |
|---|---|
| `create` | premium-gated; input = `{ name, type, …secret fields by kind }` (strict discriminated union — unknown keys rejected); creates envelope + `preview`; returns `CredentialPublic` |
| `update` | same input, must own the credential |
| `remove` | deletes; in-use warning on the UI (AF-M3-03), not a server block |
| `getOne` | metadata + `preview` + `usageCount` only |
| `list` | paginated (`page/pageSize`, `DEFAULT_PAGE_SIZE=5`, `MAX_PAGE_SIZE=100`, shared count-`where` — no off-by-one), query search, `type` filter (registry id); dialogs use `pageSize=MAX` |
| `test` | server-side probe; returns `{ ok }` or `{ ok:false, error: "AUTH"\|"CONNECTION"\|"TIMEOUT"\|"NOT_TESTABLE" }`; sets `lastUsedAt` on success |

`CredentialPublic` (`src/features/credentials/server/serialize.ts`) is the only
response shape and is `.strict()`: `id, name, type, kind, preview, lastUsedAt,
oauthExpiresAt, createdAt, updatedAt, usageCount`. **[HARD]** No procedure
returns decrypted material — a secret field in a response fails the strict
schema (asserted by `credentials-security.test.ts`). Not-testable kinds
(`apiKey`/`bearer`/`basic`/`header`) return `NOT_TESTABLE`.

### `organizations` — **[M6]**
`list` · `create` · `update` · `invite` · `acceptInvite` · `listMembers` · `updateRole` · `removeMember` · `listAuditLogs`.

### `costs` — **[M5]** *(as built AF-M5-08)*
| Procedure | Notes |
|---|---|
| `summary` | org:VIEWER; input `{ days: 1–90, default 30 }`. Returns `totals`, a zero-filled `daily` series (UTC days, `date_trunc` in parameterized raw SQL — Prisma cannot express it), `byWorkflow` / `byModel` / `topRuns` (top 10 each, by cost). Scoped through `Workflow.organizationId`, not the nullable `Execution.organizationId`. Includes test runs — a test run bills the provider like any other. |

### `ai` — **[M5]** *(as built AF-M5-07)*
| Procedure | Notes |
|---|---|
| `cacheStats` | org:VIEWER; input `{ days: 1–90, default 30 }`. Hits, misses, hit rate, `uncachedRuns`, live `entries`, and `savedUsd` (`costUsd × hitCount` over live entries). Cacheable node types come from `NodeDefinition.supportsResponseCache`, never a hard-coded list. |
| `clearCache` | org:ADMIN; input `{ expiredOnly }`. Drops this workspace's entries — the escape hatch for an answer that went stale before its TTL. |

### `analytics` — **[M7]**
`overview` · `executionsOverTime` · `topFailingWorkflows` · `usage` (quota state).
Cost surfaces (`costByModel` and the spend series) shipped early as the `costs`
router above; M7 composes them rather than re-implementing them.

### `templates` — **[M7]** (shipped AF-M7-01)

`list` · `getOne` · `instantiate`. All procedures carry `zod .input()` and are
defined in `src/features/templates/server/routers.ts`.

Templates are **tenant-agnostic gallery content** (no `organizationId` column —
see `docs/architecture/data_model.md` §2.8), so:

| Procedure | Permission rung | Input | Output key fields |
|---|---|---|---|
| `list` | `orgViewerProcedure` | `{ category?: "All" \| string, search?: string, sort?: "mostInstalled" \| "recent" \| "fewestCredentials", page?: number, pageSize?: 1..100 }` | `{ items, page, pageSize, totalCount, totalPages, hasNextPage, hasPreviousPage }` |
| `getOne` | `orgViewerProcedure` | `{ slug: string }` | list fields + `nodeSummary: { nodeId, nodeName, nodeType }[]` + `pendingCredentials: PendingCredential[]` |
| `instantiate` | `orgEditorProcedure` (target workspace editor) | `{ slug: string, workflowName?: string }` | `{ workflowId, nodeCount, pendingCredentials }` |

`PendingCredential` = `{ nodeId, nodeName, credentialType, credentialKey, optional }`.

`instantiate` semantics:
- Loads the template's `graph`, then **rewrites every node id to a fresh cuid**
  (an install can never collide with another install or the template source),
  **nulls every `credentialIdRef`** so credential-bound data fields start as
  unbound placeholders, and validates the copied graph through the engine's
  `validate()` path before writing — an invalid graph rejects with `BAD_REQUEST`
  and nothing is created.
- Creates the workflow **scoped to `ctx.org.id`** as an **unsaved draft** `Promise.all([saveWorkflow.workflow.save(), saveWorkflow.node.connect()])`.
- `pendingCredentials` is computed from the copied nodes' `data.credentialIdRef`
  placeholders and returned so the editor can surface which credentials must be
  connected before the workflow runs.
- A run before those placeholders are connected fails with the existing
  `MissingRequiredCredentialError` (visible, not silent; see
  `docs/architecture/security.md`).
- `installs` is incremented on success (`mostInstalled` sort is the gallery's
  popularity signal).

Verification: `npm run build`, `npm run lint` (Biome) and the full Vitest suite
(`npx vitest run`) pass; the spread includes 11 `templates.instantiate` unit
tests. UI (created with templates as "[PLANNED]" server features in mind):
`/templates` gallery and `/templates/[slug]` detail; the detail page's install
button calls `instantiate`, toasts "Installed as a draft", invalidates the
`templates.list`/`getOne` caches, and navigates to `/workflows/[workflowId]`.

**Shipped deviations from the deep-planned spec (recorded honestly):** the *Fork*
button is omitted; the deep-planned post-install credential dialog is replaced by
a pre-install "Before you install" checklist that explains which credentials are
required; installs always land as an unsaved draft rather than a deployed
workflow.

**Gallery content (AF-M7-02, shipped 2026-08-31).** The 20 authored templates
live in `src/features/templates/catalog/` and are the source of truth; `Template`
rows are a projection written only by `npm run seed:templates`. `nodeCount` and
`credentialCount` on every row are **derived from the graph** via
`collectPendingCredentials`, never authored, so the `fewestCredentials` sort is a
promise the data cannot break. Seeding is keyed on `slug`, leaves `installs`
untouched, and **deactivates** (`isActive: false`) rather than deletes a slug
that leaves the catalogue, so a retired template's install count and links
survive. Every spec passes `catalog/harness.ts` before it can be seeded — the
seeder re-runs it and refuses to write on any issue.

### `onboarding` — **[M7]** (shipped AF-M7-05)

`status`. One `orgViewerProcedure` query, no input, defined in
`src/features/onboarding/server/routers.ts`.

| Procedure | Permission rung | Output |
|---|---|---|
| `status` | `orgViewerProcedure` | `{ organizationId, workflowCount, credentialCount, executionCount }` |

Counts, not rows: the first-run checklist only needs to know whether the
workspace has *any* of each, and a brand-new workspace should not pay to load
lists it is about to be told are empty. All three are scoped through
`ctx.org.id` in the `where` clause; `Execution` reaches the org through its
workflow, since it carries no `organizationId` of its own.

`organizationId` is returned so the client can key its dismissal preference per
workspace — hiding the checklist in one must not hide it in another. It is the
caller's own active organization, which they are already a member of.

**No onboarding state is stored server-side.** Step completion is derived from
these counts on every read, so a tick can never claim something that has since
been deleted. Only the user's "hide this" preference is persisted, in
`localStorage` under `autoflow.onboarding.v1`.

### `search` — **[M7]** (shipped AF-M7-07)

`query`. One `orgViewerProcedure` query backing the Cmd+K command palette,
defined in `src/features/search/server/routers.ts`.

| Procedure | Permission rung | Input | Output |
|---|---|---|---|
| `query` | `orgViewerProcedure` | `{ q?: string (≤200), limit?: 1..20 (default 5, per kind) }` | `{ workflows, executions, credentials }`, each `SearchResult[]` |

`SearchResult` = `{ kind, id, title, subtitle?, href? }`.

Matching: workflows by name; executions by **id prefix**, by `ExecutionStatus`
(so "fail" finds FAILED runs), or by parent workflow name; credentials by name.
All `contains` matches are case-insensitive.

**Tenancy.** Every query filters on `ctx.org.id` in the `where` clause and is
`take`-limited per kind. `Execution` reaches the org through its workflow. The
empty-query case returns the most recent rows per kind, where org scope is the
*only* filter — covered explicitly by
`tests/integration/search-org-isolation.integration.test.ts`, in which both
orgs own rows with the identical name.

**Credential results carry `type` only** — never `preview`, never an envelope
column. There is no read path for credential secrets, and a global search box
is where an accidental one would surface; the integration suite asserts it.

Navigation destinations and actions are **not** returned here. They carry no
tenant data, are identical for every workspace, and live client-side in
`src/features/search/lib/static-commands.ts`. Ranking across all five kinds
happens on the client (`lib/fuzzy.ts`); the server decides only what this
tenant may see.

### `notifications` — **[M7]** (shipped AF-M7-08)

`list` · `unreadCount` · `markRead` · `markAllRead`, in
`src/features/notifications/server/routers.ts`.

| Procedure | Permission rung | Input | Output |
|---|---|---|---|
| `list` | `orgViewerProcedure` | `{ filter?: "all" \| "unread", page?, pageSize?: 1..100 }` | `{ items, page, pageSize, totalCount, totalPages, hasNextPage, hasPreviousPage }` |
| `unreadCount` | `orgViewerProcedure` | — | `{ count }` |
| `markRead` | `orgViewerProcedure` | `{ id }` | `{ updated: 0 \| 1 }` |
| `markAllRead` | `orgViewerProcedure` | — | `{ updated: number }` |

Both mutations are `updateMany`, not `update`: the org scope lives in the same
statement as the write, so a cross-tenant id matches zero rows and changes
nothing — no read-then-check, which is the shape cross-tenant writes hide in.
`markRead` returning `{ updated: 0 }` is therefore the normal response to
another workspace's id, and reveals nothing about whether it exists.

Notifications are **workspace-level, not per-user**: read state is shared. See
`docs/architecture/data_model.md` §2.9.

**Writers** all go through `writeNotifications` (`server/notify.ts`), the single
write path, which uses `skipDuplicates` on `dedupeKey` so a replayed step is a
no-op, and which logs-and-swallows its own failures — a notification is a
courtesy, and failing a user's run because we could not announce it would be
absurd. Producers today:

| Type | Producer | Status |
|---|---|---|
| `EXECUTION_FAILED` | runner `onFailure` | live, gated on `Workflow.notifyOnFailure` (default ON) |
| `EXECUTION_SUCCEEDED` | runner success tail | live, gated on `Workflow.notifyOnSuccess` (default OFF) |
| `CREDENTIAL_EXPIRING` | `notifyExpiringCredentials` cron (daily 03:00) | live, +7d window with a 14d grace floor |
| `APPROVAL_REQUESTED` | — | **builder ready, no producer**: nothing in the app creates `ApprovalRequest` rows yet (no approval node ships), so the approvals table has no writer either. Wiring is a one-line call from wherever that node lands. |
| `SYSTEM` | — | **no producer**: maintenance notices are an operator action with no UI or script yet. |

`Workflow.notifyOnFailure` / `notifyOnSuccess` are read by `workflows.getOne`
and written by `workflows.updateNotificationPrefs` (`orgEditorProcedure` — this
changes what the whole workspace gets told about).

---

## 4. Webhook ingress — M4

```
POST /api/webhooks/:workflowId/:path
```

| Aspect | Behavior |
|---|---|
| Auth | Per-endpoint secret header or HMAC signature, constant-time compared |
| Body | Size-capped; content-type aware (JSON, form, raw) |
| Response (async, default) | `202 { executionId }` immediately |
| Response (sync) | Waits for a `Respond` node, hard timeout → `504` |
| Unknown/inactive endpoint | Generic `404` — never reveals that the workflow exists |
| Failure | `4xx` for caller error, `5xx` for ours; never echo request content |
| Rate limit | Per endpoint and per org; `429` with `Retry-After` |

The raw payload is stored with the execution for replay, subject to retention policy.

---

## 5. REST v1 — M8

Base: `/api/v1`. Auth: `Authorization: Bearer <api_key>`, keys hashed at rest with scopes.

| Method | Path | Scope |
|---|---|---|
| GET | `/workflows` | `workflows:read` |
| GET | `/workflows/:id` | `workflows:read` |
| POST | `/workflows/:id/run` | `workflows:execute` |
| GET | `/executions` | `executions:read` |
| GET | `/executions/:id` | `executions:read` |
| POST | `/executions/:id/cancel` | `executions:write` |

Conventions:
- JSON only; `snake_case` field names (public API convention, distinct from internal camelCase — mapped explicitly at the boundary, never leaked through).
- Cursor pagination: `?limit=&cursor=` → `{ data, next_cursor }`.
- Errors: `{ error: { code, message, details? } }` with conventional HTTP statuses.
- Rate limit headers: `X-RateLimit-Limit`, `-Remaining`, `-Reset`.
- Idempotency: `Idempotency-Key` honored on `POST /run`.
- Versioning: additive changes only within v1. Breaking changes → v2, with a 6-month deprecation window announced via `Sunset` headers and changelog.

---

## 6. Inngest events

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `workflow/execute` | `{ executionId }` | trigger sources | runner |
| `workflow/cancel` | `{ executionId }` | `executions.cancel` | runner |
| `execution/completed` | `{ executionId, status, costUsd }` | runner | quotas, alerts, analytics |
| `credential/refresh` | `{ credentialId }` | scheduled sweep | OAuth refresher |
| `schedule/tick` | `{ workflowId }` | cron | trigger |

**Rule:** events carry **ids, not payloads**. The consumer loads current state from the database. Fat events go stale, blow past payload limits, and duplicate the source of truth.

Remove the demo `execute/groqai` function in `AF-M5-09`.

---

## 7. Adding a procedure — checklist

- [ ] Correct rung on the procedure ladder
- [ ] Zod `.input()`, with `.describe()` on non-obvious fields
- [ ] Tenant scoping in the `where` clause
- [ ] Correct `TRPCError` codes, including `NOT_FOUND` for cross-tenant
- [ ] Paginated if it can exceed 50 rows; `count` shares the `where`
- [ ] Large columns excluded from list selects
- [ ] Mutation returns the updated entity
- [ ] Integration test: happy path + authz rejection + cross-tenant rejection
- [ ] Registered in `src/trpc/routers/_app.ts`
- [ ] This document updated
