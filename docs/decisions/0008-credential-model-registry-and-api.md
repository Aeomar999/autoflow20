# ADR-0008: Credential model + registry + API (no plaintext read path)

**Status:** Accepted
**Date:** 2026-08-27
**Deciders:** Engineering
**Related:** ADR-0004 (envelope encryption), AF-M3-02, security.md §3

## Context

ADR-0004 chose envelope encryption for credential storage. AF-M3-01 delivered
the crypto module (`src/lib/crypto.ts`) and the `CREDENTIAL_MASTER_KEY` boot
gate. What remained was the storage shape, the type system around it, and the
API surface: the `Credential` model still carried a Cryptr-encrypted
`value: String` column with an enum `CredentialType`, the tRPC procedures used
`getMany`/mutation names inconsistent with the API contract, and the three AI
executors decrypted with the `ENCRYPTION_KEY` legacy path.

Requirements for this ADR:

1. Persist the sealed envelope (ciphertext, iv, authTag, wrappedDek,
   keyVersion) instead of a legacy string value, without breaking existing
   OPENAI/ANTHROPIC/GEMINI rows.
2. A typed credential-kind registry mirroring the node registry, so the form,
   the API input schema, and the executors derive from one definition list.
3. An API where **no procedure returns plaintext**, proven by test.

## Decision

### Model

`Credential` stores only envelope columns plus metadata — no plaintext column.
`type` is the registry id (a `String`, the enum is dropped) so new kinds need
no migration. OAuth bookkeeping lives in `oauthExpiresAt`; the UI usage count
comes from the `Node` relation.

### Registry

Two layers like the node SDK:

- `credential-types.ts` (isomorphic): kind union (`apiKey | bearer | basic |
  header | oauth2`), 8 registered defs (5 generic kinds + `openai.apiKey`,
  `anthropic.apiKey`, `gemini.apiKey`), the field list per kind, and pure
  helpers (`secretFromInput`, `maskSecretValue`, `computePreview`).
- `credential-registry.ts` (server-only): validates defs at construction
  (dup ids, unknown kinds, missing secret field), exposes `resolve/has/list/
  tester`, and owns the network testers. Being `server-only`, its logic can
  never drift into the client bundle.

### API

`credentials.create` (premium), `update`, `remove`, `getOne`, `list`
(paginated + search + kind filter), and `test` (server-side probe; plaintext
never crosses the wire). Each returning procedure is `.output(...)`-validated
with a strict `CredentialPublic` schema that enumerates metadata only, so a
secret field can never be added to a response without failing the schema.
Decryption then lives exactly two places: the node executors (engine runtime)
and the `test` probe — both server-only, neither returning material.

### Migration

A two-step switch, run in order on the same database:

1. `npm run migrate:credentials [-- --yes]` — dry-run script that decrypts
   legacy Cryptr `value` rows and rewrites them into sealed envelopes (raw SQL
   column writes, no Prisma-level `@default` backfill).
2. `npx prisma migrate deploy` — applies the schema migration
   (`20260827170000_credential_vault_af_m3_02`: drop `value`, add the five
   envelope columns + `keyVersion`, enum→text with UPDATEs to registry ids,
   drop enum, add indices). One migration is preferred over a "two-step"
   create-then-drop pair because `migrate deploy` runs it atomically and the
   data script runs first.

`ENCRYPTION_KEY` is demoted to optional and is only for the migration script.

## Consequences

**Buys us**
- Adding a credential kind = adding one def; the schema, form, and validation
  follow (with a parity test that fails on drift).
- The `.strict()` output schema is a compile-time-and-runtime backstop for the
  no-plaintext rule, not a policy.
- Old rows keep working via the one-time converter.

**Costs**
- One hand-written data migration + script to run before deploy; CI deploys
  fresh (no legacy rows), so the script is idempotent and skips clean schema.
- The `test` procedure is a second decrypt site; it must stay server-side and
  failure-only (boolean + error class), which the router and tests enforce.