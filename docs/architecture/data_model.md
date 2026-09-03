# Data Model

**Status:** Current state + target schema with the migration path.
**Read before:** writing any migration.

---

## 1. Current schema (as built)

Six models, five migrations. `prisma/schema.prisma`.

```
user ──< session
     ──< account
     ──< workflow ──< Node ──< Connection (fromNode / toNode)
verification (standalone)
```

| Model | Purpose | Notes |
|---|---|---|
| `User` | Better Auth identity | mapped to `user` |
| `Session`, `Account`, `Verification` | Better Auth | `Account` holds OAuth tokens |
| `Workflow` | A graph, owned by one user | `userId` scoped — no org, no sharing |
| `Node` | A node on the canvas | `type String`, `data Json`, `position Json` |
| `Connection` | An edge with typed handles | unique on `(fromNodeId, toNodeId, fromOutput, toInput)` |

**Problems to fix:**

| # | Problem | Fix | Task |
|---|---|---|---|
| 1 | ~~`NodeType` Postgres enum with one value (`INITIAL`) — a migration per node type~~ **Resolved** (`AF-M1-02`): enum dropped, `typeVersion`/`disabled`/`notes` added, `INITIAL` rows migrated to `core.manual-trigger`, write-time registry validation | Done | `AF-M1-02` |
| 2 | Dead `Post` table from the initial migration | Drop | `AF-M0-02` |
| 3 | Ownership is `userId` — blocks teams, roles, sharing | Re-parent to `organizationId` | `AF-M6-01` |
| 4 | No `revision` on `Workflow` — concurrent saves silently overwrite | Add `revision Int` with optimistic concurrency | `AF-M1-03` |
| 5 | No execution history at all | `Execution` + `NodeExecution` | `AF-M2-01` |
| 6 | No credentials | `Credential` | `AF-M3-02` |
| 7 | `Node` and `Connection` are unmapped (PascalCase tables) while others use `@@map` | Normalize naming in the M1 migration | `AF-M1-02` |

---

## 2. Target schema

Presented in dependency order. Each block notes the milestone that introduces it.

### 2.1 Tenancy — M6

```prisma
model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  plan      Plan     @default(FREE)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members     Membership[]
  workspaces  Workspace[]
  credentials Credential[]
  auditLogs   AuditLog[]

  @@map("organization")
}

enum Plan { FREE PRO ENTERPRISE }
enum Role { OWNER ADMIN EDITOR VIEWER }

model Membership {
  id             String   @id @default(cuid())
  organizationId String
  userId         String
  role           Role     @default(EDITOR)
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([userId])
  @@map("membership")
}

model Workspace {
  id             String @id @default(cuid())
  organizationId String
  name           String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  workflows      Workflow[]

  @@index([organizationId])
  @@map("workspace")
}
```

Every tenant-scoped table carries `organizationId` **directly**, even when it is reachable via a parent. Denormalizing it makes the tenant filter a single indexed predicate on every query instead of a join, and makes accidental cross-tenant reads structurally harder.

### 2.2 Workflow graph — M1

```prisma
model Workflow {
  id             String  @id @default(cuid())
  organizationId String                       // M6; userId until then
  workspaceId    String?
  name           String
  description    String?
  active         Boolean @default(false)      // M4
  revision       Int     @default(0)          // optimistic concurrency — M1
  activeVersionId String?                     // M4
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  nodes       Node[]
  connections Connection[]
  versions    WorkflowVersion[]
  executions  Execution[]

  @@index([organizationId, updatedAt(sort: Desc)])
  @@index([workspaceId])
  @@map("workflow")
}

model Node {
  id          String  @id @default(cuid())
  workflowId  String
  name        String
  type        String                          // registry id, e.g. "http.request" — NOT an enum
  typeVersion Int     @default(1)             // M1
  data        Json    @default("{}")
  position    Json
  disabled    Boolean @default(false)         // M1
  notes       String?                         // M1
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workflow          Workflow     @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  outputConnections Connection[] @relation("FromNode")
  inputConnections  Connection[] @relation("ToNode")

  @@index([workflowId])
  @@map("node")
}

model Connection {
  id         String @id @default(cuid())
  workflowId String
  fromNodeId String
  toNodeId   String
  fromOutput String @default("main")
  toInput    String @default("main")

  workflow Workflow @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  fromNode Node     @relation("FromNode", fields: [fromNodeId], references: [id], onDelete: Cascade)
  toNode   Node     @relation("ToNode",   fields: [toNodeId],   references: [id], onDelete: Cascade)

  @@unique([fromNodeId, toNodeId, fromOutput, toInput])
  @@index([workflowId])
  @@map("connection")
}
```

`Node.type` is a `String` validated against the registry at write time. This is the single most important schema decision in the project: an enum makes the node catalogue require a migration per node, which caps the product at a handful of nodes. See ADR 0001.

### 2.3 Versioning — M4

```prisma
model WorkflowVersion {
  id          String   @id @default(cuid())
  workflowId  String
  version     Int
  graph       Json                            // full immutable snapshot
  publishedAt DateTime @default(now())
  publishedById String
  note        String?

  workflow   Workflow    @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  executions Execution[]

  @@unique([workflowId, version])
  @@index([workflowId, publishedAt(sort: Desc)])
  @@map("workflow_version")
}
```

Draft (`Node`/`Connection` rows) and published (`WorkflowVersion.graph`) are separate. Editing never changes what production runs.

### 2.4 Execution history — M2

```prisma
enum ExecutionStatus     { QUEUED RUNNING SUCCESS FAILED CANCELLED TIMED_OUT }
enum NodeExecutionStatus { PENDING RUNNING SUCCESS FAILED SKIPPED }
enum TriggerType         { MANUAL WEBHOOK SCHEDULE API SUBWORKFLOW }
enum ExecutionMode       { PRODUCTION TEST }

model Execution {
  id                String   @id @default(cuid())
  organizationId    String
  workflowId        String
  workflowVersionId String?
  status            ExecutionStatus @default(QUEUED)
  trigger           TriggerType
  mode              ExecutionMode   @default(PRODUCTION)
  graphSnapshot     Json                       // what actually ran — immutability
  input             Json?
  error             Json?
  startedAt         DateTime?
  finishedAt        DateTime?
  durationMs        Int?
  nodeCount         Int      @default(0)
  tokensIn          Int      @default(0)
  tokensOut         Int      @default(0)
  costUsd           Decimal  @default(0) @db.Decimal(12, 6)
  createdById       String?
  createdAt         DateTime @default(now())

  workflow       Workflow         @relation(fields: [workflowId], references: [id], onDelete: Cascade)
  nodeExecutions NodeExecution[]

  @@index([organizationId, createdAt(sort: Desc)])
  @@index([workflowId, createdAt(sort: Desc)])
  @@index([status])
  @@map("execution")
}

model NodeExecution {
  id          String @id @default(cuid())
  executionId String
  nodeId      String
  nodeName    String
  nodeType    String
  typeVersion Int    @default(1)
  status      NodeExecutionStatus @default(PENDING)
  attempt     Int    @default(1)
  input       Json?                            // truncated above the cap
  output      Json?                            // truncated above the cap
  error       Json?
  skipReason  String?
  startedAt   DateTime?
  finishedAt  DateTime?
  durationMs  Int?
  tokensIn    Int     @default(0)
  tokensOut   Int     @default(0)
  costUsd     Decimal @default(0) @db.Decimal(12, 6)
  model       String?                          // provider:model that served it (M5-08)
  cacheHit    Boolean?                         // null = no cache configured (M5-07)

  execution Execution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  @@index([executionId, startedAt])
  @@index([nodeType])
  @@map("node_execution")
}
```

Notes:
- `costUsd` is `Decimal(12,6)`, never a float. Money in floats produces reconciliation bugs that are painful to unwind later. *(Shipped as `Float` from M2 through AF-M5-08; converted to `Decimal(12,6)` in `AF-M8-11` — migration `20260831140000_cost_usd_float_to_decimal`.)*
- `model` is the model the fallback chain actually served with, not the one configured — per-model cost reporting (`AF-M5-08`) would otherwise attribute spend to a model that never ran.
- `cacheHit` is deliberately three-valued: `null` means the node had no response cache configured, so it belongs in neither half of a hit rate; `false` is a real miss. See `AiResponseCache` below.
- `nodeName`/`nodeType` are **denormalized** onto `NodeExecution` so a trace remains readable after the node is deleted from the workflow.
- These are the highest-growth tables in the system. **Retention is enforced as of `AF-M8-06`** (the note here previously pointed at `AF-M8-04`, which is the auth-email task): a nightly `sweep-execution-history` cron applies a per-plan, two-stage policy from `src/lib/retention.ts` — `input`/`output` are nulled at `ioRetentionDays`, and the `Execution` row is deleted at `deleteAfterDays` with `NodeExecution` following by cascade. Redaction deliberately keeps status, timings, tokens, `costUsd`, `model`, and error text, so the monitoring and cost dashboards stay truthful over rows whose payloads are gone. The delete window may never be shorter than `QUOTA_SAFE_DELETE_FLOOR_DAYS` (35) because the runner meters the monthly quota by counting `Execution` rows in the current calendar month — a shorter window would refund quota. **Partitioning is deliberately deferred** behind a stated trigger; see ADR-0016.

### 2.5 Credentials — M3

```prisma
model Credential {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  type           String                       // credential registry id, e.g. "slack.oauth2"
  ciphertext     Bytes                        // AES-256-GCM payload
  iv             Bytes
  authTag        Bytes
  wrappedDek     Bytes                        // DEK wrapped by the KEK
  keyVersion     Int     @default(1)
  preview        String?                      // e.g. "sk-...4f2a" — safe for display
  oauthExpiresAt DateTime?
  lastUsedAt     DateTime?
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([oauthExpiresAt])                   // refresh sweep
  @@map("credential")
}
```

There is **no plaintext column and no read path**. `preview` is generated at write time and is deliberately non-reversible.

> **As built, AF-M3-02 (2026-08-27).** The target above adds org tenancy; the
> shipped table is tenant-scoped by `userId` until the M-org migration (data
> model §3-step 1), plus `@@index([type])` (kind-filtered list) and a `Node[]`
> relation for usage counts (`_count.Node`). `type` holds the **registry id**,
> not an enum: the 8 kinds in `src/features/credentials/credential-types.ts`
> (`apiKey`/`bearer`/`basic`/`header`/`oauth2` + provider-scoped ids). The
> five envelope columns are all `Bytes`/`Int` per ADR-0004. Schema migration:
> `prisma/migrations/20260827170000_credential_vault_af_m3_02` (drops the
> legacy `value` column; data ported by `npm run migrate:credentials`).

### 2.6 Governance — M6

```prisma
model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  actorId        String?
  actorType      String   @default("USER")    // USER | API_KEY | SYSTEM
  action         String                        // "workflow.publish", "credential.delete"
  resourceType   String
  resourceId     String
  before         Json?
  after          Json?
  ip             String?
  userAgent      String?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, createdAt(sort: Desc)])
  @@index([resourceType, resourceId])
  @@map("audit_log")
}
```

Append-only. No update or delete path exists in application code; enforce with a DB-level revoke in production.

### 2.7 AI response cache — M5

```prisma
model AiResponseCache {
  id             String   @id @default(cuid())
  organizationId String
  cacheKey       String                        // sha256 of the canonical request envelope
  nodeType       String
  model          String                        // provider:model that produced it
  response       Json                          // { value: <node result> }
  tokensIn       Int      @default(0)
  tokensOut      Int      @default(0)
  costUsd        Float    @default(0)
  hitCount       Int      @default(0)
  createdAt      DateTime @default(now())
  lastHitAt      DateTime?
  expiresAt      DateTime

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, cacheKey])
  @@index([organizationId, createdAt(sort: Desc)])
  @@index([expiresAt])                          // daily sweep
}
```

Notes:
- **The workspace is part of the lookup, not just the hash.** `cacheKey` alone
  is identical across tenants for an identical prompt; the unique constraint
  and every query are on `(organizationId, cacheKey)`, so one tenant's entry is
  unreachable from another's (engineering_rules §1.3).
- `cacheKey` fingerprints everything that can change the answer — node type,
  the ordered model chain, the compiled prompts, and the call parameters
  (`src/lib/ai/cache.ts`). Editing a prompt or a temperature misses; it never
  replays the previous answer under new config.
- `response` wraps the result as `{ value }` so a non-object node result (the
  AI Chat node returns a string) is still valid JSON.
- Reads filter on `expiresAt`, so correctness never depends on the sweep
  (`sweepAiResponseCache`, daily) — a missed sweep leaves dead rows, not stale
  answers.
- `hitCount × costUsd` is the provider spend the entry has avoided; that is
  what `ai.cacheStats` reports as `savedUsd`.

### 2.8 Template — M7

```prisma
model Template {
  id              String   @id @default(cuid())
  slug            String   @unique            // stable URL + getOne key
  name            String
  description     String   @db.Text
  category        String                       // open set, never an enum
  tags            String[]                     // open set
  graph           Json                         // workflow-graph shape (nodes + edges)
  featured        Boolean  @default(false)
  isActive        Boolean  @default(true)      // drives gallery visibility
  nodeCount       Int      @default(0)         // denormalized gallery metadata
  credentialCount Int      @default(0)
  author          String   @default("AutoFlow")
  version         String   @default("1")
  installs        Int      @default(0)         // "mostInstalled" sort
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([category, isActive])
}
```

Shipped `20260831000000_template_model` (AF-M7-01). Notes:
- **Tenant-agnostic by design** (engineering_rules §1.3): the gallery is public product
  content, so there is **no** `organizationId` column. `list`/`getOne` are org-viewer
  reads that touch only `Template`; `instantiate` is the only procedure that crosses
  into tenant data, and it does so by creating a workflow scoped to `ctx.org.id`.
- `graph` is the same shape `save-graph` accepts (nodes with `id/name/type/position`
  and a `data` object holding *unbound* config values — credential-bound fields carry
  `null`/absent `credentialIdRef`, never a real credential id). `instantiate` rewrites
  every node id to a fresh cuid, so two installs of the same template can never
  collide, and validates the copied graph through the engine's `validate()` before
  persisting.
- Metadata (`nodeCount`, `credentialCount`, `tags`, `featured`) is authored, not
  derived at read time — it feeds the gallery filters and cards without a per-row
  node scan.

### 2.9 Notifications — M7

Migration `20260831180000_notification_model` (AF-M7-08). Additive: a
`NotificationType` enum, the `Notification` table, and two boolean columns on
`Workflow`.

```prisma
model Notification {
  id             String           @id @default(cuid())
  organizationId String                                  // tenant scope
  type           NotificationType
  title          String
  message        String           @db.Text
  href           String?                                 // where it opens
  readAt         DateTime?                               // null = unread
  dedupeKey      String           @unique                // replay guard
  workflowId     String?                                 // FK, cascade
  executionId    String?                                 // plain column
  credentialId   String?                                 // plain column
  createdAt      DateTime         @default(now())
}
```

- **Tenant-scoped, not per-user.** A notification belongs to the workspace, and
  everyone who can see the workspace sees it — matching how executions and
  approvals already behave. The consequence is that **read state is shared**:
  one member marking something read marks it read for the team. Per-user
  read state would need a join table and is deliberately not in v1.
- **`dedupeKey` is the replay guard**, and the reason writes go through
  `writeNotifications` with `skipDuplicates`. Inngest can re-run a step whose
  memo it lost, `onFailure` can fire alongside a partial tail, and a cron runs
  again on every redeploy. Keys are composed from the **logical event** —
  `execution:<id>:<type>`, `credential:<id>:expiring:<expiry ISO>`,
  `approval:<id>` — never from a timestamp, so a replay collides with the row
  it already wrote instead of announcing the same thing twice.
- **`workflowId` is a real FK with cascade**; `executionId` and `credentialId`
  are deliberately plain columns. They exist to build `href` and to let a caller
  correlate, and keeping them FK-free means a pruned execution or a deleted
  credential leaves the notification history intact rather than erasing what was
  announced. The trade-off is a link that can 404, which is preferable to
  history that silently disappears.
- **`Workflow.notifyOnFailure` defaults `true`, `notifyOnSuccess` defaults
  `false`.** A run that broke is the thing people need told about; a workflow on
  a five-minute cron with success notifications on would write 288 rows a day
  and make the centre worthless. Existing workflows adopt both defaults.
- Indexes serve the only two reads: `(organizationId, createdAt DESC)` for the
  list and `(organizationId, readAt)` for the bell's unread count.

### 2.11 Trigger state and run files — M10

Two models added by M10, both additive and both owned entirely by their
framework rather than by the nodes that benefit from them.

#### `TriggerState` (AF-M10-05, ADR-0024)

One row per `(workflowId, nodeId)`, org-scoped, cascading from both parents.

| Column | Why it exists |
|---|---|
| `cursor Json?` | Opaque, poller-defined resume point (a timestamp, a page token, a row number). Persisted verbatim. |
| `lastSeenIds String[]` | The last 500 dispatched item ids. Providers answer "changed since T" inclusively, so consecutive polls overlap; without the window the overlap dispatches twice. |
| `lastPolledAt` | Interval scheduling. Null means never polled, which is what makes the first poll suppress dispatch rather than replay history. |
| `failureCount`, `lastError`, `nextPollAt` | Exponential backoff. One broken credential must not be retried every minute for a month. |
| `keyFingerprint` | Hash of the config fields that define what an item *is*. When it changes the id window is cleared, because the stored ids answer a question the node no longer asks. |

A poller never writes this table. It returns `{ items, cursor }`; dispatch,
dedupe, cursor persistence and backoff are the framework's.

#### `StoredFile` (AF-M10-06, ADR-0025)

The row a `FileRef` points at. Bytes live in the blob store; this is the
metadata, the tenancy, and the lifetime.

| Column | Why it exists |
|---|---|
| `organizationId` | Every read is checked against it. A `FileRef` is a plain object in a run context — a `CODE` node could mint one — so the id alone is not authorization. |
| `executionId` | Ties blob lifetime to AF-M8-06 execution retention. **`ON DELETE SET NULL`, not `CASCADE`** — see below. |
| `expiresAt` | For files with no run to inherit a lifetime from (an intake-form upload arriving before the run exists). 48 hours. |
| `size`, `sha256` | Quota is summed from `size` rather than kept in a counter. `sha256` is on the reference so the AF-M5-07 response cache can key on attachment content (AF-M10-07). |
| `storageKey`, `backend` | The object's address and which implementation wrote it, so a migrated install can still read old rows. |

**The `SET NULL` is deliberate and worth stating.** `CASCADE` is the obvious
choice, it looks tidier, and it silently leaks storage forever: the row is the
only record of the object's key, so deleting it with the execution makes the
database forget a file that is still occupying storage and being paid for. The
retention sweep instead deletes a run's blobs *before* deleting the run.

### 2.10 Later

| Model | Milestone | Purpose |
|---|---|---|
| `WebhookEndpoint` | M4 | path, secret, method, response mode |
| `UsageCounter` | M7 | per-org period counters for quota enforcement |
| `ApiKey` | M8 | hashed key, scopes, rate limit, `lastUsedAt` |
| `Document`, `Chunk`, `Embedding` | Phase 2 | RAG (pgvector) |
| `AgentMemory` | Phase 2 | agent conversational + long-term memory |

---

## 3. Migration sequence

| Order | Migration | Milestone | Risk |
|---|---|---|---|
| 1 | `drop_post_table` | M0 | none |
| 2 | ~~`node_registry_types`~~ Shipped as `20260821000000_drop_nodetype_enum` (`AF-M1-02`) — drops the `NodeType` enum, adds `typeVersion`/`disabled`/`notes`, migrates `INITIAL` rows to `core.manual-trigger`. `Workflow.revision` still pending (`AF-M1-03`). | M1 | **medium** — includes a data migration for existing `INITIAL` nodes |
| 3 | `execution_history` — `Execution`, `NodeExecution`, enums, indices | M2 | low (additive) |
| 4 | `credentials` | M3 | low (additive) |
| 5 | `workflow_versions` + `webhook_endpoints` | M4 | low (additive) |
| 6 | `ai_cache` — shipped as `20260830140000_ai_response_cache` (`AF-M5-07`: `AiResponseCache` + nullable `NodeExecution.cacheHit`) and `20260830150000_node_execution_model` (`AF-M5-08`: `NodeExecution.model`) | M5 | low (additive) |
| 7 | `tenancy` — `Organization`, `Membership`, `Workspace`, `organizationId` backfill on every tenant table | M6 | **high** — see §4 |
| 8 | `audit_log` | M6 | low (additive) |
| 9 | `templates` + `usage_counters` | M7 | low (additive) — `Template` shipped as `20260831000000_template_model` (AF-M7-01); `UsageCounter` not yet built |
| 10 | `api_keys` + execution partitioning | M8 | medium |

---

## 4. The tenancy migration (M6) — the risky one

Re-parenting from `userId` to `organizationId` touches every table and every query. Do it in expand-migrate-contract order and never in a single step:

1. **Expand.** Add `Organization`, `Membership`, `Workspace`. Add **nullable** `organizationId` to `Workflow`, `Credential`, `Execution`.
2. **Backfill.** For each existing user, create a personal organization, an `OWNER` membership, and a default workspace; set `organizationId` on all their rows. Run as an idempotent, resumable script — not inline in a migration.
3. **Verify.** Assert zero rows with a null `organizationId`; assert every user has exactly one owned org.
4. **Migrate reads.** Move procedures to `orgProcedure` **one router at a time**, each behind a passing cross-tenant isolation test. Dual-scope (`userId` AND `organizationId`) during transition.
5. **Contract.** Make `organizationId` non-null, add indices, drop `userId` scoping from application code.

Do not run feature work against the same files during this migration.

---

## 5. Conventions

- Ids: `cuid()`. Never sequential integers for anything externally visible.
- Timestamps: `createdAt @default(now())` and `updatedAt @updatedAt` on every mutable model.
- Tables: `snake_case` via `@@map`. Existing `Node`/`Connection` are unmapped — normalized in migration 2.
- Enums: only for genuinely closed sets (`ExecutionStatus`, `Role`, `Plan`). **Never** for an extensible catalogue.
- Money: `Decimal(12,6)`. Never `Float`.
- JSON columns: only for genuinely schemaless payloads, always validated with Zod at the application boundary.
- Deletes: cascade from the tenant root. Soft-delete only where recovery is a stated product requirement.
- Index every FK and every column used in a `where`/`orderBy` on a growth table.
