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

### `credentials` — **[M3]**
`list` · `getOne` (metadata + `preview` only) · `create` · `update` · `remove` (warns on in-use) · `test`.
**[HARD]** No procedure returns decrypted material. Asserted by test.

### `organizations` — **[M6]**
`list` · `create` · `update` · `invite` · `acceptInvite` · `listMembers` · `updateRole` · `removeMember` · `listAuditLogs`.

### `analytics` — **[M7]**
`overview` · `executionsOverTime` · `costByModel` · `topFailingWorkflows` · `usage` (quota state).

### `templates` — **[M7]**
`list` · `getOne` · `instantiate`.

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
