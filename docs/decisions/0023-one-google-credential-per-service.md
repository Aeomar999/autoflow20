# 0023 — One Google credential per service, not one per user

**Status:** Accepted (AF-M10-03); implemented 2026-09-03 in `src/features/credentials/`.
**Companion:** `docs/architecture/security.md` §3; ADR-0011 (node-type deprecation lifecycle, whose rule this applies to credential types); ADR-0022 (credentials on the generic HTTP node).

## Context

21 of M10's 35 automations touch Google — Sheets reads and writes, Gmail send and poll, Drive download/upload/move, Calendar reads.

Before this decision there was one Google credential type, `google.oauth2`, and its `defaultScopes` was `https://www.googleapis.com/auth/userinfo.email`. A user who connected Google received a token that could read their email address and nothing else. `GOOGLE_SHEETS_APPEND` worked only because tokens minted earlier happened to carry a broader grant — an accident, not a design.

The obvious fix — widen `google.oauth2` to cover everything the library needs — has a property that disqualifies it. Every node in every workflow in the org resolves *the same credential row*. Widening it to include `gmail.readonly` means a workflow written to append rows to a spreadsheet is holding a token that can read the connecting user's mail. Nothing in the product would stop it, and nothing in the trace would show it. The user consented once, to "Google".

A second problem surfaced while reading the code: the OAuth callback created credentials with a `userId` and **no `organizationId`**. Every read path is org-scoped — `credentials.list` filters on it, and the engine resolves a node's credential by `{ id, organizationId }`. An OAuth credential was therefore invisible in the UI and unresolvable at run time. Connecting Google appeared to succeed and then nothing could use it.

## Decision

**1. Five scoped credential types replace the one.**

`google.sheets`, `google.gmail`, `google.drive`, `google.calendar`, `google.docs`, each with its own `defaultScopes` in `oauth-providers.ts`:

| Type | Scopes |
|---|---|
| `google.sheets` | `auth/spreadsheets` |
| `google.gmail` | `auth/gmail.readonly`, `auth/gmail.send`, `auth/gmail.modify` |
| `google.drive` | `auth/drive` |
| `google.calendar` | `auth/calendar.readonly` |
| `google.docs` | `auth/documents`, `auth/drive.readonly` |

The consent screen is the enforcement point: `buildAuthorizeUrl` puts exactly one service's scopes in the `scope` parameter, and `oauth.test.ts` asserts per type that no scoped credential drags in another service's scopes.

`gmail.modify` is in Gmail's set because it is what lets a polling trigger mark a message read or move it between labels — the mechanism by which a trigger avoids reprocessing the same mail. It does not grant permanent deletion.

**2. `google.drive` takes the full `drive` scope.**

AF-M10-05's task text suggested `drive.file drive.readonly`. That combination cannot express the automations that need Drive: `drive.file` only ever sees files this app itself created, so "watch the folder a user drops contracts into" (#28, #29, #30) returns nothing, and `drive.readonly` cannot move a processed file to `/approved`. The narrower scope would not be more secure — it would be non-functional, and the workaround people reach for is a service account with broader access and no audit trail.

The per-service split is precisely what makes this acceptable: Drive's breadth stays inside the Drive credential and cannot be reached by a Sheets workflow.

**3. `google.oauth2` is deprecated, not removed.**

It stays registered, resolvable and refreshable. `CredentialTypeDef` gains a `deprecated` marker mirroring `NodeDefinition.deprecated`, and `credentialPalette` (the "new credential" picker) filters on it — so the population of legacy credentials can only shrink.

A node's `credentials[].type` accepts a `|`-separated alternation: `GOOGLE_SHEETS_APPEND` declares `"google.sheets|google.oauth2"`. Saved nodes keep resolving their existing credential; new bindings get the scoped type. This is ADR-0011's retirement rule applied to credential types, for the same reason: re-pointing saved nodes at a type the user has not connected breaks running workflows in order to tidy a registry.

**4. OAuth credentials are org-scoped, and the org travels in the signed state.**

The active org is resolved at connect time — while the app's own cookies are present — and carried through the redirect inside the HMAC-signed state. The callback cannot re-derive it reliably: it is entered from the provider, and nothing guarantees the same org is still selected.

The state token is also hardened while it is being touched: the signature comparison is constant-time (a `!==` on two strings leaks how many leading characters matched), and states expire after 15 minutes.

One credential per `(org, provider)`. Two members connecting Google for the same workspace update one connection; a user in two orgs gets one credential per org.

## Consequences

**Buys.** A workflow's Google access is bounded by the service it was built for. The consent screen tells the truth about what the user is granting. OAuth credentials become usable at all, which they were not.

**Costs.** A user automating across Sheets *and* Gmail now connects twice and sees two rows in the credentials list. That is the honest cost of the guarantee, and the alternative is a single row that can do both in every workflow forever.

Five near-identical credential types exist where there was one. They are generated from one factory rather than copied, so the marginal cost of the sixth is a line.

**Forecloses.** Nothing structural. If Google ever ships incremental authorization we can adopt it per type; `include_granted_scopes=false` is set explicitly today so a second connection does not silently accumulate the union of prior grants.

## Alternatives considered

**Widen the single `google.oauth2` scope set.** Rejected — it is the failure this ADR exists to prevent. Every workflow in the org would share one over-granted token.

**One credential per user per service, keyed by user rather than org.** Rejected: workflows run on behalf of the organization, not the person who happened to click Connect, and a per-user model means a workflow stops when that person leaves. The org-scoped row with a recorded `userId` keeps the audit trail without coupling the automation to an individual's session.

**Ask for scopes incrementally, at the moment a node first needs them.** Attractive and rejected for now: it needs a consent round-trip in the middle of an authoring session and a place to park a half-configured node. Revisit if the two-connections cost turns out to bite.

**Delete `google.oauth2` and migrate saved nodes.** Rejected. The migration cannot mint a token for a type the user has not consented to, so every affected workflow would break at the next run with an unresolvable credential — the exact outcome ADR-0011 exists to prevent.
