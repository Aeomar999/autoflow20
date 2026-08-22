# 0004 — Envelope encryption for credentials

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering

## Context

AutoFlow will hold the credentials that let customers' workflows reach their CRM, database, email, and cloud accounts. A breach here does not expose our data — it exposes theirs, at scale, across every customer. This is the highest-consequence subsystem in the product.

Nothing exists yet: no credential model, no encryption, no redaction layer, and the credentials page is a stub.

Requirements: encrypted at rest, key rotation without re-encrypting every payload, a path to KMS/HSM and per-customer BYOK (Phase 3), no plaintext read path, and no leakage into logs, traces, or error messages.

## Decision

**Envelope encryption.**

```
plaintext --AES-256-GCM(DEK)--> ciphertext + iv + authTag
DEK       --AES-256-GCM(KEK)--> wrappedDek
stored on the row: ciphertext, iv, authTag, wrappedDek, keyVersion
```

- A per-credential data encryption key (DEK); the DEK is wrapped by a key encryption key (KEK) supplied as `CREDENTIAL_MASTER_KEY`.
- The KEK never lives in the database, the repository, or a log. The application refuses to boot without it.
- `keyVersion` per row enables rolling rotation.
- **There is no read path for plaintext.** No tRPC procedure, REST endpoint, server action, or server component returns decrypted material — not to the owner, not to an admin, not for a "test" button.
- The single decrypt call site is the engine's `NodeExecutionContext` construction.
- The UI displays only a non-reversible `preview` generated at write time.
- All logging goes through a redacting logger; Sentry applies the same redaction. Tests assert plaintext is absent from procedure output, from `NodeExecution` IO, and from logs.

## Consequences

**Buys us**
- Key rotation re-wraps small DEKs instead of re-encrypting every payload.
- Migrating the KEK to a KMS/HSM, or to a per-customer key for BYOK, changes one function rather than the storage format.
- GCM authentication means tampering fails loudly rather than degrading to garbage or empty.
- "No read path" is a structural guarantee, not a policy someone can forget.

**Costs**
- Key management becomes an operational responsibility from M3 onward: secure storage, restricted access, and a documented loss/compromise procedure. **If the KEK is lost, every credential is unrecoverable** — customers must re-enter them. This must be in the runbook.
- Dev ergonomics: the app will not start without a key. Accepted — a soft fallback is exactly how a dev key reaches production.
- No "show my API key" feature, ever. Users re-enter rather than reveal. This is a deliberate product constraint, not an oversight.

**Forecloses**
- Server-side search over credential contents.
- Support staff inspecting a customer's credential to debug. Debugging uses error classes and connection tests instead.

## Alternatives considered

**Encrypt directly with a single master key.** Rejected: rotation requires re-encrypting every payload, and BYOK becomes a rewrite.

**Store credentials in an external secret manager (Vault, AWS Secrets Manager).** Stronger, and a plausible future move. Rejected for M3: added infrastructure and vendor coupling before we have customers; envelope encryption in Postgres with `keyVersion` keeps the migration path open.

**Application-level encryption via a Prisma middleware/extension.** Rejected: too easy to bypass accidentally, and it makes the decrypt call sites invisible. We want exactly one, and we want it obvious in a diff.

**Per-organization keys from day one.** Deferred to BYOK in Phase 3. `keyVersion` and the wrapping indirection make it additive.

## Follow-up

- `AF-M3-01` implements `src/lib/crypto.ts` with tests: round-trip, tamper detection, wrong key, rotation.
- `AF-M8-05` must include a credential-exposure runbook: revoke, rotate KEK, re-wrap, notify.
