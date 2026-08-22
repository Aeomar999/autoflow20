# 0001 — Node registry as the core abstraction

**Status:** Accepted
**Date:** 2026-08-02
**Deciders:** Engineering

## Context

The product requires roughly 500 node types at launch and 100+ connectors after that. The current implementation cannot support this:

- `NodeType` is a **Postgres enum** with one value, `INITIAL` (`prisma/schema.prisma:96`). Every new node type would require a schema migration.
- `src/config/node-components.ts` maps node types to React components by hand, so every node also requires an editor change.
- There is no runtime side to a node at all — nothing describes what a node *does*.

Three separate consumers need to agree about a node: the editor (palette, canvas, config form), the API (validate a save), and the engine (execute it). If those three carry their own knowledge, they drift, and the symptom is a workflow that validates in the browser and fails at runtime.

## Decision

A **node definition is the single source of truth** for a node type, and every other subsystem is a generic consumer of the registry.

- `Node.type` is a `String` validated against the registry. The `NodeType` enum is dropped.
- Each node lives in `src/nodes/<namespace>/<node>/` with `definition.ts` (isomorphic: id, version, category, label, icon, Zod `configSchema`, ports, credential requirements) and `execute.ts` (server-only implementation).
- `manifest.ts` composes definitions for the client; `registry.ts` composes definitions **and** implementations for the server. The bundler therefore cannot pull an implementation into the browser.
- The palette, config form, canvas validation, save validation, and runner all read the registry. **No subsystem contains per-node logic.**
- `Node.typeVersion` plus an optional `migrate()` lets a node's schema evolve without breaking saved workflows.

Adding a node type is adding a folder. Nothing else changes.

## Consequences

**Buys us**
- Node count becomes a function of engineering hours, not architecture. This is the difference between a demo and a platform.
- Config forms are generated from the Zod schema, so canvas linting (PRD §5.2) is free and cannot drift from runtime validation.
- The same schema validates in the browser, at save, and at compile time — one implementation, three call sites.
- A future third-party node SDK (Phase 3) is the same contract, published.

**Costs**
- The form generator only supports a documented subset of Zod, and must fail loudly at dev time on anything outside it.
- A `type` id is permanent. Renaming one breaks every saved workflow, so ids need care at authoring time.
- The definition/execute split is one more file per node and an unfamiliar convention for new contributors.

**Forecloses**
- Nodes with bespoke, non-schema-driven config UI. If a node genuinely needs one, that is a registry capability (`customEditor`), not an escape hatch.

## Alternatives considered

**Keep the Postgres enum.** Rejected: a migration per node type caps the catalogue at a handful and makes community/third-party nodes impossible.

**Definition and implementation in one file, tree-shaken.** Rejected: relies on the bundler to keep server code out of the client. A credential-handling implementation reaching the browser is a security incident; we do not want that guarded by an optimization.

**Config as free-form JSON with per-node hand-written forms.** Rejected: no validation story, no linting, and the editor grows a branch per node — the exact coupling this ADR removes.

**JSON-schema-based node definitions loaded at runtime (n8n-style descriptors).** Rejected for now: loses TypeScript type safety across the boundary. Revisit if third-party nodes need to ship without a deploy.
