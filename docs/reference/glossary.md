# Glossary

Shared vocabulary. Ambiguity here becomes ambiguity in the schema, the API, and the UI — the PRD itself lists "where to draw the line between *workflow* and *agent* in the UI" as an open question. These are the answers we build against.

---

## Core

**Workflow** — a directed graph of nodes that AutoFlow can execute. The authored artifact. Has a draft state (what you are editing) and, once published, versions (what production runs).

**Node** — one step in a workflow. Identified by a registry **node type** (`http.request`), carrying user **config** and a canvas **position**. A node instance is a row; a node type is code.

**Node type** — an entry in the node registry: a `NodeDefinition` plus an `execute` implementation. Adding a node type is adding a folder under `src/nodes/`.

**Connection / Edge** — a link from one node's **output port** to another's **input port**. "Connection" in the database, "edge" in React Flow. Same thing.

**Port / Handle** — a named attachment point on a node. `core.condition` has two output ports, `true` and `false`. "Handle" is React Flow's term.

**Trigger** — a node with no inputs that starts a workflow: manual, webhook, schedule, API. Exactly one per workflow.

**Execution (also: Run)** — one attempt to execute a workflow, start to finish. Prefer **execution** in code and the data model; **run** is acceptable in UI copy. A `NodeExecution` is one node's participation in one execution, including one retry attempt.

**Graph snapshot** — the copy of the graph stored on an execution, so history stays truthful after the workflow is edited.

**Item** — the unit of data between nodes: `{ json, binary? }`. Nodes consume and produce arrays of items, which is what makes fan-out, merge, and looping generic.

**Expression** — `{{ ... }}` in a config value, resolved against the run context immediately before execution. Parsed and resolved, never evaluated as code.

---

## AI

**Agent** — a node that pursues a goal by reasoning in a loop and calling tools, rather than executing a fixed sequence. **A workflow is authored; an agent decides.** That distinction is the one users must be able to feel in the UI. Phase 2.

**Tool** — a capability an agent may invoke. In AutoFlow, tools are existing node types exposed to the agent, so every integration is automatically agent-usable.

**Delegation** — Agent A calls Agent B, waits, and receives the result plus context. Control returns to A.

**Handoff** — Agent A permanently transfers the conversation to Agent B. Control does not return.

**Confidence** — an agent's self-reported certainty, surfaced in the trace and usable as a routing dimension (below a threshold → escalate to a human).

**Model routing** — choosing which LLM serves a call, by explicit config or a rule (cheapest-capable, lowest-latency, A/B bucket).

**Fallback chain** — an ordered list of models tried on failure, timeout, or budget exhaustion. The trace records which one actually served the call.

**RAG** — retrieval-augmented generation: retrieve relevant chunks from a knowledge base and include them in the prompt. Phase 2.

**Knowledge base** — ingested documents, chunked and embedded, that agents retrieve from.

---

## Platform

**Organization** — the billing and ownership boundary. All tenant data hangs off it. M6.

**Workspace** — a grouping of workflows within an organization. M6.

**Membership / Role** — a user's association with an organization and their permission level: `OWNER` > `ADMIN` > `EDITOR` > `VIEWER`.

**Tenant-scoped** — a query or record constrained to one organization. Every query against tenant data is tenant-scoped; there are no exceptions.

**Credential** — encrypted authentication material for an external system. Stored with envelope encryption; decrypted only inside the execution runtime; never returned by any API.

**Credential type** — the shape of a credential (`slack.oauth2`, `http.generic`), registered like node types.

**Secret vs. config** — a secret is a credential and lives in the vault. Config is non-sensitive and lives on the node. A field named `apiKey` in a config schema is a bug.

**Audit log** — an append-only record of who did what to which resource, when. Distinct from execution traces (what a workflow did) and application logs (what our code did).

**Quota** — a plan-enforced cap on executions or AI spend per period.

**Publish / Activate** — publishing snapshots the draft into a `WorkflowVersion`; activating makes a version the one production triggers run. Editing a draft never affects the active version.

**Revision** — an integer on a workflow used for optimistic concurrency. A save with a stale revision returns `CONFLICT` instead of silently overwriting someone's work.

---

## Statuses

**Execution:** `QUEUED` → `RUNNING` → `SUCCESS` | `FAILED` | `CANCELLED` | `TIMED_OUT`

**Node execution:** `PENDING` → `RUNNING` → `SUCCESS` | `FAILED` | `SKIPPED`

**`SKIPPED`** — the node was in the graph but not executed, always with a recorded reason (branch not taken, run cancelled, upstream failure). A node in the compiled graph is **never** absent from the trace; that is the property that separates our observability story from the competition's.

**`continueOnFail`** — a per-node setting: on failure, record `FAILED`, emit an error item, and let the run continue. Off by default.

**Retryable** — an error class the node declares as worth retrying (429, 5xx, network). Determined by the node, never guessed by the engine.

---

## Terms we deliberately avoid

| Avoid | Use | Why |
|---|---|---|
| "Zap", "Scenario" | Workflow | Competitor vocabulary |
| "Job" | Execution | Ambiguous with Inngest's internals |
| "Step" | Node | "Step" means an Inngest step in our code |
| "Bot" | Agent, or Slack/Teams **deployment** | Imprecise |
| "Integration" (for a node) | Node type, or connector | "Integration" is the vendor relationship |
| "Task" (for a run) | Execution | Task-based pricing is the thing we sell against |
