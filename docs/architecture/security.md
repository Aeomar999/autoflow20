# Security

**Status:** Specification + current-state assessment.
**Read before:** touching credentials, secrets, auth, webhooks, outbound HTTP, or anything that executes user-supplied content.

An automation platform holds the keys to every system its customers connect. The blast radius of a credential breach here is not our data — it is theirs. Treat this document as binding.

---

## 1. Current posture — honest assessment

| Control | State |
|---|---|
| Transport encryption | ✅ TLS via hosting |
| Password storage | ✅ Better Auth (hashed) |
| Session management | ✅ Better Auth |
| Authorization | 🟠 Ownership-only (`userId`). No roles, no workspace boundary. |
| Credential storage | 🔴 **None exists.** No model, no encryption. |
| Secrets in logs | 🔴 No redaction layer. Sentry receives raw context. |
| Audit trail | 🔴 None. |
| Rate limiting | 🔴 None on any route, including auth. |
| SSRF protection | 🔴 None (no HTTP node yet — must land with it). |
| Webhook authentication | 🔴 No webhook endpoints yet. |
| Input validation | 🟠 Zod on tRPC inputs; nothing on other surfaces. |
| Dependency scanning | 🔴 No CI, no audit. |
| Env validation | 🔴 Unvalidated `process.env` reads. |

Nothing here is alarming for a pre-alpha, but every 🔴 must close before external users touch the system. Most are M0–M3 tasks.

---

## 2. Threat model

| # | Threat | Impact | Primary control |
|---|---|---|---|
| T1 | Credential exfiltration via DB compromise | Critical — customer systems breached | Envelope encryption; KEK outside the DB |
| T2 | Credential leak via logs/Sentry/traces | Critical | Redacting logger; no credentials in `NodeExecution` IO; tests |
| T3 | Cross-tenant data access | Critical | `orgProcedure` + scoped `where` + isolation test suite |
| T4 | SSRF via user-configured HTTP node into cloud metadata (`169.254.169.254`) or internal services | High | URL allow/deny checks on every outbound user-controlled request |
| T5 | RCE via expression evaluation or a code node | Critical | Parsed expressions, never `eval`; sandboxed code node or none |
| T6 | Webhook forgery triggering workflows | High | Per-endpoint secret/signature verification + rate limits |
| T7 | Privilege escalation via a broken role check | High | Middleware-enforced roles; deny by default; tests per role |
| T8 | Resource exhaustion by one tenant | Medium | Quotas, concurrency keys, run limits |
| T9 | Malicious third-party node (marketplace, Phase 3) | Critical | Not shipping until isolation is solved |
| T10 | Supply-chain compromise via a dependency | High | Lockfile, `npm audit` in CI, minimal new deps |
| T11 | Session hijacking | High | Secure cookies, short-lived sessions, rotation on privilege change |
| T12 | Prompt injection steering an agent's tool use | High (Phase 2) | Tool allowlists, human approval for destructive tools, output validation |

---

## 3. Credential handling — the central control

### Encryption

Envelope encryption:

```
plaintext --AES-256-GCM--> ciphertext          (with a per-record DEK)
DEK       --AES-256-GCM--> wrappedDek          (with the KEK from CREDENTIAL_MASTER_KEY)
stored:   ciphertext, iv, authTag, wrappedDek, keyVersion
```

Why envelope rather than encrypting directly with the master key: key rotation becomes a re-wrap of small DEKs rather than a re-encryption of every payload, and migrating the KEK to a KMS/HSM (or per-customer BYOK in Phase 3) is a change to one function.

Rules:
- **[HARD]** `CREDENTIAL_MASTER_KEY` is 32 bytes, base64-encoded, supplied by environment. The app refuses to boot without it.
- **[HARD]** The KEK never lives in the database, in the repo, or in a log.
- **[HARD]** GCM auth tags are verified. A tampered ciphertext fails loudly; it never degrades to plaintext or empty.
- Dev and production keys are always different. The documented dev key is public and therefore worthless — never promote it.

### Access

- **[HARD]** No tRPC procedure, REST endpoint, server action, or server component returns decrypted credential material. There is no read path. Not for the owner, not for an admin, not "just for the test button".
- **[HARD]** Decryption happens in exactly two server-only sites: the node executors' runtime (`openSecret`, `src/features/credentials/server/vault.ts`) and the `test` connection probe. Never in a response path.
- **[HARD]** Credential values never appear in `NodeExecution.input` or `output`. Node authors must not echo config secrets — enforced by review and by a test per credentialed node.
- "Test connection" runs server-side and returns a boolean plus an error class. Never the request that was sent.
- The UI shows `preview` only — a non-reversible fragment generated at write time.

> **Implemented, AF-M3-02 (2026-08-27).** `Credential` stores the sealed
> envelope (ADR-0004) with **no plaintext column**; `type` is the registry id
> (8 kinds in `credential-types.ts`). Every credential-returning procedure is
> `.output(...)`-validated against a `.strict()` `CredentialPublic` schema — a
> leaked secret field fails the schema, and `credentials-security.test.ts`
> asserts schema, select, and serializer stay closed. `openSecret` validates
> byte columns at runtime (rows cross Inngest serialization). Legacy rows are
> converted by `npm run migrate:credentials` (registry id mapping
> OPENAI→openai.apiKey, etc.).

### Rotation

`keyVersion` on every row enables rolling rotation: new writes use the current KEK; a background job re-wraps older rows; decrypt supports N-1 versions during the window.

---

## 4. Authentication and authorization

**Now:** email/password via Better Auth; `requireAuth()` on pages; `protectedProcedure` on tRPC.

**Target (M6):**
- SSO: Google + GitHub. (SAML/SCIM/Okta is Phase 3 — do not promise it before then.)
- `orgProcedure(minRole)` resolves membership once per request and enforces `OWNER > ADMIN > EDITOR > VIEWER`.
- **Deny by default.** A new procedure without an explicit role requirement must not compile past review.
- **[HARD]** Authorization lives in the `where` clause or middleware — never a post-fetch `.filter()`. Post-fetch filtering leaks existence through counts, timing, and error differences.
- **[HARD]** Accessing another tenant's resource returns `NOT_FOUND`, not `FORBIDDEN`. `FORBIDDEN` confirms the resource exists.
- Session cookies: `httpOnly`, `secure`, `sameSite=lax`. Rotate on privilege change.

---

## 5. Outbound requests (SSRF)

Any node that fetches a user-supplied URL — HTTP Request, webhook-out, URL ingestion, image fetch — passes through `src/lib/ssrf.ts` first.

Blocked by default:
- loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16` — cloud metadata), private ranges (`10/8`, `172.16/12`, `192.168/16`), unique-local IPv6
- non-`http`/`https` schemes
- redirects that land on any of the above (**re-check after every hop** — checking only the initial URL is the classic bypass)
- DNS results resolving to blocked ranges (re-resolve and pin, or use a checked-resolve fetch, to close the TOCTOU window)

Enterprise allowlisting of internal ranges is a per-organization setting, off by default, audit-logged when enabled.

---

## 6. Executing user-supplied content

Two distinct problems; do not conflate them.

**Expressions** (`{{ $json.x }}`) are parsed and resolved against a context object. **No `eval`, no `new Function`, no `vm`.** This is why the expression language is deliberately limited — the limitation is the security control.

**Code nodes** (Phase 2+) require real isolation before they ship. Acceptable directions: a separate hardened service with a per-execution container, a WASM runtime (QuickJS/Pyodide) with no host bindings, or a vendor sandbox. **Unacceptable: `vm`/`vm2`/`isolated-vm` in the main Node process.** Requirements: no filesystem, no network except through declared node APIs, CPU and memory caps, hard wall-clock timeout, no access to other tenants' data.

**Third-party nodes** (marketplace, Phase 3) are the same problem plus code distribution and review. Not shipping until the sandbox exists.

---

## 7. Webhooks

`POST /api/webhooks/:workflowId/:path` (M4):

- **[HARD]** Verify a per-endpoint secret or HMAC signature before doing any work. Use constant-time comparison.
- **[HARD]** Rate-limit per endpoint and per organization.
- Enforce a body size cap; reject oversized payloads before parsing.
- Respond `202` immediately by default. Synchronous respond mode has a hard timeout.
- Store the raw payload for replay and debugging, subject to retention.
- Never reflect request content into an error message (XSS/SSRF pivot into the trace viewer).
- An unknown or inactive endpoint returns a generic `404` — never "workflow exists but is inactive".

---

## 8. Rate limiting (M8, partial in M4)

| Surface | Limit | Key |
|---|---|---|
| Login / signup | 5 attempts / 15 min | IP + email |
| Password reset | 3 / hour | email |
| Webhook ingress | plan-dependent | endpoint + org |
| Public API | plan-dependent | API key |
| tRPC mutations | burst cap | user |
| Workflow executions | plan quota | organization |

Rate-limit responses use `429` with `Retry-After`. They are audit-logged when they indicate an attack pattern.

---

## 9. Logging and PII

- **[HARD]** All logging goes through `src/lib/logger.ts`, which redacts keys matching `/(token|secret|password|apikey|api_key|authorization|cookie|credential|private[_-]?key)/i` at any depth, including inside arrays.
- **[HARD]** Sentry's `beforeSend` applies the same redaction, and request bodies/headers are stripped.
- Execution IO is customer data: access is tenant-scoped, retention is bounded, and it is excluded from support tooling by default.
- Never log a full request body from a webhook — it is arbitrary customer data.

---

## 10. Dependencies and supply chain

- Lockfile committed; CI installs with `npm ci`.
- `npm audit --audit-level=high` in CI; HIGH/CRITICAL blocks merge.
- New dependencies justified in the PR (`docs/engineering/engineering_rules.md` §10). Prefer the existing stack.
- Pin the Next.js minor — this version's churn is a real risk (see `AGENTS.md` header).

---

## 11. Compliance roadmap

Sequenced, not simultaneous. Do not market ahead of it.

| Stage | Requirements | Milestone |
|---|---|---|
| Baseline hygiene | Encryption at rest + in transit, audit logs, RBAC, backups, incident response plan | M3–M6 |
| SOC 2 Type I | Policies, access reviews, change management, vendor management | Post-Beta |
| SOC 2 Type II | ~6 months of evidence | Phase 3 |
| GDPR | DPA, data export, right to erasure, EU residency option, sub-processor list | Phase 3 |
| HIPAA | BAA, PHI handling, stricter retention and logging | Phase 3 |
| FedRAMP | Substantial program; only with a committed government customer | Phase 3+ |

---

## 12. Incident response

1. **Detect** — Sentry alerts, anomalous auth/rate-limit patterns, customer report.
2. **Contain** — revoke affected credentials, disable affected endpoints/keys, rotate the KEK if credential exposure is suspected.
3. **Assess** — use `AuditLog` and execution history to scope exactly what was accessed.
4. **Notify** — affected customers, within the window their agreement and applicable law require.
5. **Remediate + post-mortem** — blameless, with a regression test for the root cause.

Runbooks for the top five failure modes are `AF-M8-05`. A credential-exposure runbook is mandatory before Beta.

---

## 13. Pre-Beta security checklist

- [ ] All credentials encrypted at rest; no plaintext read path anywhere (proven by test)
- [ ] Redacting logger in place; Sentry scrubbing verified
- [ ] Cross-tenant isolation test suite green across every procedure
- [ ] Role enforcement tested for every role × every mutating procedure
- [ ] SSRF guard on every user-controlled outbound request, including redirect hops
- [ ] Webhook signature verification + rate limiting
- [ ] Rate limits on auth, API, and webhook surfaces
- [ ] Audit logging on every mutation
- [ ] `npm audit` clean at HIGH+
- [ ] Env validation at boot; app refuses to start misconfigured
- [ ] Session cookie flags verified in production
- [ ] Backup + restore rehearsed, not just configured
- [ ] Incident response runbook written and walked through once
- [ ] External review or penetration test scheduled
