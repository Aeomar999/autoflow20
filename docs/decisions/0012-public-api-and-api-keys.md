# 0012 - Public REST API with scoped, hashed API keys

**Status:** Accepted (AF-M8-01).

## Context

AutoFlow's only programmatic surface is tRPC, which is coupled to the web
client and has no compatibility guarantee. External API clients need a stable
surface. `docs/architecture/api_contract.md` §5 defines the target shape of a
public REST v1; no model, key material, or route exists yet.

The security posture (`docs/architecture/security.md`) is binding: credentials
are never stored or returned in plaintext, every surface is tenant-scoped, and
an unknown resource returns `NOT_FOUND` (never `FORBIDDEN`).

## Decision

### 1. API keys are random high-entropy tokens, hashed at rest

- The secret is `af_` + 40 base62 random bytes, shown **once** at creation.
- Only the **prefix (first 8 chars, for support lookup)** and a **SHA-256 hash
  of the full token** are stored. The hash is the lookup key, so an API key
  owner cannot recover the token, and a DB leak yields only hashes.
- Lookup: derive the hash from the presented `Bearer` token and look the row
  up. No per-row decryption, no per-tenant scanning — constant-time at the DB.

### 2. Scopes gate every endpoint

- Scopes are a **string set** on the key: `workflows:read`, `workflows:execute`,
  `executions:read`, `executions:write`.
- Scope check is deny-by-default: an endpoint requires its scope, and a key
  missing it is rejected with `FORBIDDEN`. Enum for the open scope set is
  deliberately avoided (engineering rule: open sets are strings, not enums),
  and unknown scopes on an existing key (future additive scopes) are ignored.

### 3. Auth model

- `Authorization: Bearer af_...`. Keys are org-scoped: the resolved org is the
  key's `organizationId`, and all queries enforce it in the `where` clause.
  There is no per-request org header — the key *is* the tenant boundary.
- Role is not consulted: API keys are NOT members and carry no RBAC role. Their
  permissions come entirely from scopes. A key can never exceed the data a
  member of that org could see, and every row is still org-scoped.
- Native members (session auth) and API keys are **independent** authentication
  paths: an API key does not imply a member session and vice versa.

### 4. HTTP conventions

- `snake_case` field names, mapped explicitly at the boundary (distinct from the
  internal camelCase; never leaked through).
- Error envelope `{ error: { code, message, details? } }`; codes mirror the tRPC
  codes from `api_contract.md` §2.
- Cursor pagination: `?limit=&cursor=` → `{ data, next_cursor }`, ordered by
  `startedAt desc, id desc` for stable cursor semantics (the cursor encodes the
  last row's sort tuple).
- `POST /workflows/:id/run` honors an `Idempotency-Key` header to prevent
  duplicate runs on retry.

### 5. Rate limiting

- Per-key token-bucket limits, keyed by the resolved key id, with limits
  derived from `Organization.plan` (reusing `src/lib/quotas.ts` plan data, which
  is the org-plan source of truth per ADR-0010). `429` + `Retry-After` on
  breach; the small in-memory store is per-instance (documented limitation, to
  be replaced by a shared store in AF-M8-02).

### 6. Management surface

- `apiKeys` tRPC router: `list`, `create`, `revoke`, each `orgProcedure`-gated
  and audit-logged (`actorType: "API_KEY"` already exists on `AuditLog` for the
  key's own mutations; management actions are `USER` actors). The plaintext
  token is returned only by `create` and only once.

## Consequences

- API-key secrets are irreversible: a lost token must be revoked and recreated.
- Per-instance rate-limit state is not shared across replicas; a global store is
  a follow-up (AF-M8-02 defines the full rate-limit design).
- The public surface is additive-only within v1; breaking changes go to v2 with
  a deprecation window (per `api_contract.md` §5).
