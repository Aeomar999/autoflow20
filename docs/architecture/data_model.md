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

  execution Execution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  @@index([executionId, startedAt])
  @@index([nodeType])
  @@map("node_execution")
}
```

Notes:
- `costUsd` is `Decimal(12,6)`, never a float. Money in floats produces reconciliation bugs that are painful to unwind later.
- `nodeName`/`nodeType` are **denormalized** onto `NodeExecution` so a trace remains readable after the node is deleted from the workflow.
- These are the highest-growth tables in the system. Retention and partitioning are `AF-M8-04`.

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

### 2.7 Later

| Model | Milestone | Purpose |
|---|---|---|
| `WebhookEndpoint` | M4 | path, secret, method, response mode |
| `AiResponseCache` | M5 | `hash → response`, TTL, workspace-scoped |
| `Template` | M7 | gallery entries with graph + metadata |
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
| 6 | `ai_cache` | M5 | low (additive) |
| 7 | `tenancy` — `Organization`, `Membership`, `Workspace`, `organizationId` backfill on every tenant table | M6 | **high** — see §4 |
| 8 | `audit_log` | M6 | low (additive) |
| 9 | `templates` + `usage_counters` | M7 | low (additive) |
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
