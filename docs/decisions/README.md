# Architecture Decision Records

An ADR captures a consequential decision, the context that forced it, and what we accepted in exchange. It exists so that six months from now nobody re-litigates a settled question from scratch — and so an AI agent reading this repo cold does not "helpfully" undo a deliberate choice.

## When to write one

Write an ADR when a decision:
- adds a dependency to the critical path,
- fixes the shape of persisted data,
- draws or moves an abstraction boundary,
- trades away a capability we might later want,
- or would be surprising to a competent engineer reading the code.

Do **not** write one for: naming, formatting, library choices with no lock-in, or anything already settled in `docs/engineering/engineering_rules.md`.

## Format

```markdown
# NNNN — Title

**Status:** Proposed | Accepted | Superseded by NNNN | Deprecated
**Date:** YYYY-MM-DD
**Deciders:** names

## Context
What forced a decision. Constraints and facts, not opinions.

## Decision
What we are doing. Present tense, unambiguous.

## Consequences
What this buys, what it costs, what it forecloses.

## Alternatives considered
Each with the reason it lost.
```

## Rules

- Numbered sequentially, never renumbered.
- Immutable once Accepted. To change a decision, write a new ADR and mark the old one `Superseded by NNNN`.
- Reference the ADR from the code or doc it governs.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-node-registry-as-core-abstraction.md) | Node registry as the core abstraction | Accepted |
| [0002](0002-inngest-as-execution-runtime.md) | Inngest as the durable execution runtime | Accepted |
| [0003](0003-phase-1-scope-cut.md) | Phase 1 scope cut | Accepted |
| [0004](0004-credential-envelope-encryption.md) | Envelope encryption for credentials | Accepted |
| [0005](0005-tenancy-timing.md) | Introduce tenancy at M6, not later | Accepted |
| [0006](0006-expressions-not-eval.md) | Expressions are parsed, not evaluated | Accepted |
| [0007](0007-handlebars-runtime-compilation.md) | Handlebars runtime compilation kept, sandboxed | Accepted |
| [0008](0008-credential-model-registry-and-api.md) | Credential model + registry + API (no plaintext read path) | Accepted |
| [0009](0009-ai-provider-registry.md) | AI provider registry with capability + pricing data | Accepted |
| [0010](0010-org-level-plan-as-quota-source.md) | Org-level `Organization.plan` is the quota source of truth | Accepted |
| [0011](0011-node-type-deprecation-lifecycle.md) | Node types are retired by deprecation, never by deletion | Accepted |
| [0012](0012-public-api-and-api-keys.md) | Public REST API with scoped, hashed API keys | Accepted |
| [0013](0013-rate-limit-store.md) | Shared injectable rate-limit store (in-memory default, no new dependency) | Accepted |
| [0014](0014-resend-for-auth-email.md) | Resend for transactional auth email | Accepted |
| [0015](0015-guarded-fetch-for-redirects.md) | The SSRF guard owns redirect following, via a `fetch` given to the client | Accepted |
| [0016](0016-execution-retention-over-partitioning.md) | Two-stage execution retention now; partitioning deferred behind a trigger | Accepted |
