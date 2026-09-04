# 0022 — Credentials on the generic HTTP node

**Status:** Accepted (AF-M10-01); implemented 2026-09-03 in `src/nodes/http/request/`, `src/nodes/shared/http-auth.ts`, `src/nodes/shared/redact.ts`.
**Companion:** `docs/nodes/http-request.md`; ADR-0015 (guarded fetch for redirects), ADR-0017 (pinned-address egress), ADR-0004 (credential envelope encryption).

## Context

M10 ports 35 reference automations spanning **34 distinct third-party services**. Counted by reading the source document, **31 of the 35 are ultimately an authenticated REST call** — a `GET` with a bearer token, a `POST` with an API key in a header, a Google endpoint with `?key=`.

Before this decision, `HTTP_REQUEST` declared no `credentials` at all. The only way to authenticate one was to type the secret into its `headers` map. That is worse than inconvenient: node config is persisted verbatim into `NodeExecution.input` (AF-M9-18), so a token pasted into a header is **in the trace before the executor runs**, violating the AF-M3-04 rule that plaintext never reaches a trace row. The alternative — a bespoke node per service — is 34 node families before a single template can be authored, and it makes every new provider an engineering task.

The counter-argument is real: a node that accepts *any* credential type cannot type-check the pairing. Nothing stops a user selecting a Postgres credential for a Stripe endpoint.

## Decision

**1. `HTTP_REQUEST` declares `credentials: [{ key: "credentialId", type: "*", required: false }]`.**

`"*"` is a wildcard in `CredentialRequirement.type`, matched by `acceptedCredentialTypes` (`src/features/credentials/credential-match.ts`). The same grammar admits `"a|b"` for a requirement that accepts either of two types, which is how a deprecated credential type keeps working through its overlap window (used by ADR-0023 for the scoped Google types).

The requirement is **optional**. An `HTTP_REQUEST` saved before M10 has no `credentialId` and no `authMode`; it validates and runs exactly as it did. There is no migration.

**2. The secret is read only from `NodeRunParams.credentials`.**

The executor never reads secret material from `data`. This is not a style preference — `data` is what the engine persists as `NodeExecution.input`, so anything that arrives through config is already in the trace. `src/nodes/http/request/execute.test.ts` asserts a token placed in config is ignored and the node fails as unbound.

**3. Six auth modes, one translation module.**

`authMode` is `none | bearer | header | basic | queryParam | oauth2`, translated by `buildHttpAuth` in `src/nodes/shared/http-auth.ts`. Service node families reuse it, so there is exactly one place that knows how a stored secret becomes an `Authorization` header.

`oauth2` reads `accessToken` and nothing else. It does **not** fall back to an API key: sending the wrong secret to an OAuth endpoint fails in a way that looks like a permissions problem, and users spend hours on it. Token freshness is the existing AF-M3 responsibility — the `refresh-oauth-tokens` cron rewrites `accessToken` in place every 15 minutes for credentials inside their expiry window. The executor reads the field and never refreshes inline or caches a token across runs.

**4. Auth does not survive a cross-origin redirect — including custom header names.**

`safeFetch` already dropped `authorization`, `cookie` and `proxy-authorization` when a redirect hop leaves the origin (ADR-0015). That list is the fetch spec's, and it is not sufficient here: this node can authenticate with an arbitrary header name, and an `X-API-Key` is exactly as sensitive as an `Authorization`. `buildHttpAuth` therefore reports `credentialHeaderNames`, and the executor passes them to `createSafeFetch`, which strips them alongside the spec's three.

A redirect that stays on the same origin keeps the auth: that is the ordinary `/v1/thing` → `/v1/thing/` case, and dropping it there would break real APIs for no security gain.

**5. Secrets sent are redacted from the value the node returns.**

Keeping plaintext out of the trace needs one more step once a node authenticates: an endpoint that echoes the request back (debug services, API gateways, the fixture servers this milestone is tested against) puts the credential in the **response body**, which the executor returns as its output and the engine persists. `redactSecrets` (`src/nodes/shared/redact.ts`) replaces every secret this request actually sent with `[redacted]` before the payload leaves the executor. For `basic`, both the raw password and the base64 blob are treated as secret, because the blob is trivially reversible.

Values shorter than 6 characters are not searched for — redacting a two-character "secret" would blank arbitrary response text, and destroying real data is a worse failure than leaving a value that short unprotected.

## Consequences

**Buys.** Most of Phase B stops being integration work and becomes configuration: a new provider needs a credential type, not a node family. Work on 34 services can proceed in parallel rather than in series. The trace-safety invariant gets stronger than it was — before this, nothing scrubbed an echoed secret out of an unauthenticated node's output either.

**Costs.** The credential/endpoint pairing is unchecked. A user can select a Postgres credential for a Stripe call; the failure is a provider 401, not a validation error. We accept this: the wildcard is what makes the node general, and a type system strong enough to reject the pairing would have to know every provider's base URL — which is the bespoke-node design this decision rejects.

Redaction is a string scan over the node's output on every authenticated call. Bounded by ADR-0018's per-node output cap, so it is a scan of at most ~1 MiB against a handful of needles.

**Forecloses.** Nothing. A service that genuinely needs bespoke handling (Google's per-service scopes, QuickBooks' `realmId`, Slack's `ok: false` envelope) still gets its own node family; those families build on this auth path rather than around it.

## Alternatives considered

**A node family per service, no generic auth.** Rejected: 34 families before any template ships, and it makes every future provider an engineering task rather than a config change. Families still exist where a service needs more than auth — that is Phase B — but they are no longer the price of admission.

**A `credentialType` config field the user must match to the endpoint.** Rejected: it moves the unchecked pairing from the credential picker to a second field the user can get equally wrong, and adds a field to every node's config for no enforced guarantee.

**Templating the secret into headers with a `{{$credential.x}}` expression.** Rejected outright. The resolved template lands in the request *and* in whatever the executor returns, and the expression would have to be evaluated against a context that contains plaintext — reintroducing the exact leak AF-M9-05 removed.

**Redacting at the trace-write boundary instead of in the executor.** Considered seriously; it would cover every node at once. Rejected for now because the engine does not know which secrets a given node actually sent — only the executor does. Doing it centrally would mean redacting *every* field of *every* resolved credential from *every* node's output, including credentials the node never used, which is both slower and more likely to blank legitimate data. Revisit if a third node type needs it.
