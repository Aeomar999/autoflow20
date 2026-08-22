# 0003 — Phase 1 scope cut

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering, with product sign-off required

## Context

The source documents disagree with each other about Phase 1:

- `Autoflow_PRD.md` §4: ~500 nodes, multi-model AI, RBAC/SSO/audit, knowledge base, REST API — in 3–4 months. Self-hosting deferred to Phase 3.
- `I want to build Autoflow_...md`: 5,000+ integrations, self-hosting, multi-agent orchestration, RAG, local LLMs, Git version control, real-time collaboration — in Phase 1.

The audited baseline is a SaaS shell with workflow CRUD and a canvas that cannot save. There is no execution engine, one inert node type, no credentials, no run history, and zero tests.

Neither Phase 1 definition is reachable from that baseline in 3–4 months at any realistic staffing. Continuing to plan against an unreachable scope produces the predictable outcome: a broad, shallow, half-working surface with no defensible product in it.

## Decision

The PRD is the authority. Phase 1 is explicitly re-scoped, and the cuts are recorded rather than discovered later.

**We ship to Beta (~26 weeks, 2–3 engineers):**
graph persistence · node SDK · **25 node types** · durable execution engine · node-level execution traces · encrypted credentials with OAuth refresh · webhook and schedule triggers · publish/versioning/rollback · multi-model AI with token and cost attribution · workspaces with RBAC and audit logs · Google/GitHub SSO · **20 templates** · monitoring dashboard · quotas · public REST v1 (read + trigger).

**We explicitly do not ship in Phase 1:**
500+ nodes · 5,000 integrations · agents · multi-agent orchestration · RAG/knowledge base · marketplace · self-hosting · Okta/SAML/SCIM · GraphQL · SDKs · CLI · Git sync · A/B testing · ROI dashboards.

Full table with per-item rationale: `docs/planning/implementation_plan.md` §2.

## Consequences

**Buys us**
- A coherent, defensible product: author visually → run durably → debug node-by-node with cost attribution, across five model providers, with encrypted credentials and team RBAC. Nothing in the competitive set does all of that well.
- Realistic dates, which makes go-to-market planning possible instead of theatrical.
- The engine gets built properly. Everything deferred is a client of it and gets *cheaper* once it exists.

**Costs**
- Node and integration count will look thin next to n8n (400+) and Zapier (7,000+) in a feature-grid comparison. Positioning must lead with depth, observability, and cost intelligence — not breadth.
- "Agentic builder platform" is the product's name and thesis, and agents arrive in Phase 2. Messaging before then must be honest about that.
- Some competitive claims in the sales material are not true at Beta and must not be used until they are.

**Forecloses**
- Nothing structurally. Every cut item is additive on top of the engine.

## Alternatives considered

**Attempt the PRD's Phase 1 as written.** Rejected: at the required pace, the engine gets ~2 weeks instead of 4+, and everything downstream inherits a fragile runtime. The market analysis's own diagnosis of competitors — "prototypes that cannot productionize" — is exactly what this produces.

**Ship agents first, since it is the differentiator.** Rejected: agents on a runtime that cannot execute a node, retry, or produce a trace is demoware. It is also, precisely, the OpenAI Agent Builder failure mode we are selling against.

**Fork or embed n8n for node breadth.** Not evaluated in depth; licensing (sustainable-use) and architectural coupling make it a strategic decision, not an engineering one. Worth a real evaluation before Phase 3 if breadth becomes the binding constraint — record a new ADR if so.

## Review

Re-open this ADR — in writing, with a new ADR — if a design partner makes a specific cut item a purchase blocker. Do not re-open it mid-sprint by informal agreement.
