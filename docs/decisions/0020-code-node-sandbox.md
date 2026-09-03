# 0020 - Code node sandbox: worker thread + `node:vm`, hard caps, no host bindings

**Status:** Accepted (AF-M9-13); implemented 2026-09-03 in `src/nodes/core/code/`.
**Companion:** `docs/architecture/security.md` §6 ("Executing user-supplied content").

## Context

The CODE node lets a user run arbitrary JavaScript on the workflow context. `docs/architecture/security.md` §6 already drew the line: **no `eval`, no `new Function`, no `vm` "in the main Node process"** for user expressions or node code. But "no vm" cannot be absolute — a CODE node is the explicit, deliberate carve-out, and the whole reason the expression language is limited is that expressions are not a general runtime. The carve-out needs a hard boundary that holds.

The threat model is the platform's own: AutoFlow holds every customer's credentials (T1/T2) and any tenant can write a workflow. An unconstrained CODE node is remote code execution in the process that can decrypt every customer's secrets and reach the network. The sandbox exists precisely to make CODE-tenant code as far away from that power as we can get without shipping a second hardened service.

Three candidate directions from §6: a separate hardened service with per-execution containers, a WASM runtime with no host bindings, or a vendor sandbox. None is buildable in the M9 window without a new runtime dependency and a deploy target. What *is* available in the existing Node process, with the §6 prohibition honoured by moving off the main thread, is a **worker thread whose only job is to run the user code inside a `node:vm` context with resource limits**, and nothing else.

## Decision

**1. User code runs in a dedicated `worker_threads` Worker; inside that worker only, it executes in a `node:vm` context.** The `vm` call is never on the main/Inngest thread — it happens inside a Worker created solely for this node's attempt. This satisfies the §6 "not in the main Node process" constraint literally and structurally: the main process receives only a structured-cloned result or an error message from the worker, never the execution itself.

**2. The sandbox exposes no host bindings.** The `vm` context is a fresh realm with the standard intrinsics (`Math`, `JSON`, `Number`, `Array`, `Object`, `String`, `Date`, …) and **nothing else** injected. No `require`, no `import`, no `process`, no `buffer`, no `setTimeout`/`setInterval`, no `fetch`, no `global`/`globalThis` assignment target worth having. There is no path to the filesystem, the network, child processes, or the parent realm's `Object.prototype` (prototype pollution stays inside the sandbox realm; structured clone only ships the returned value).

**3. Hard caps, every one a loud `NonRetriableError`, never silent truncation.** Defaults, freely configurable per node within the listed ceilings:

| Cap | Default | Ceiling | Enforced where |
|---|---|---|---|
| Wall clock | 5 s | 30 s | parent `worker.terminate()` after the budget |
| Heap | 64 MB | 256 MB | `worker.resourceLimits` (`maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`) |
| Output | 1 MB | 1 MB | parent, on the structured-cloned result |

A breach throws a `NonRetriableError` naming the limit ("exceeded the 5000ms wall-clock limit", "exceeded the 64MB heap limit", "exceeded the 1048576-byte output limit"). These run inside the node's own `step.run`, so the engine's existing per-node timeout and ADR-0018 output cap remain as outer backstops, not replacements.

**4. Input is the node's resolved context, read-only.** The worker receives `nodeInputValue` (AF-M9-12) via structured clone; the sandbox hands it to the user's code as a frozen `input`. The code is the body of a function `(input) => { … }`. It returns either an object (merged into the node output) or an array (stored under `items` for the downstream SPLIT_OUT contract).

**5. Errors carry the user's line number.** The wrapper is generated with a known prefix-line count, so a thrown `Error`'s stack line is rebased to the user's source line, and that (plus the message) is what reaches `NodeExecution.error` — with no internal path names or payload echoed.

**6. No `require`/`import`/dynamic module loading, period.** Even inside the worker, the vm context has no module loader. Code is a body, not a full module. Pure logic only.

**7. CPU accounting is out of scope for M9-13.** `worker.resourceLimits` has no accurate "CPU used" readout we can round-trip into `StepUsage` (which today meters only tokens/cost — see `src/inngest/trace.ts`). The run's wall-clock `durationMs` already lands in the trace. True CPU-cost metering (AF-M7-04, not billed in M9) is a documented follow-up, not a silent gap.

## What this explicitly is NOT

- Not a general-purpose language host. No modules, no host APIs, no network, no npm.
- Not a claim that a Worker+vm is as strong as a per-execution container or a WASM sandbox. It is the strongest isolation available in this process without a new runtime, and it is the ceiling for CODE until a hardened execution service ships (Phase 3, §6 / T9).
- Not a path around the SSRF guard. A CODE node cannot make network calls at all, so it has nothing to bypass.

## Consequences

- The main process is never exposed to a user's parse/execution stack at full privilege; the worst a runaway does is starve a single Worker, which the parent kills on timeout.
- `docs/architecture/security.md` §6 is updated to record the carve-out: "no vm in the main Node process" remains, with the CODE-worker exception documented alongside.
- A security test suite (`src/nodes/core/code/sandbox.test.ts`) locks in the required behaviours: infinite loop killed, allocation bomb killed, `process`/`require`/`fetch`/`setTimeout` undefined, prototype pollution contained, network impossible.
- A genuine tenant isolation / hardening upgrade (per-execution container, WASM, vendor sandbox) can replace the worker without changing the node's public contract — the sandbox is confined to one module, `runUserCode`.

## Alternatives considered

**`vm` directly on the main thread.** Rejected — that is the exact §6 prohibition and the worst case for everything after (escape → RCE with credential access).

**`isolated-vm` / `quickjs-emscripten`.** Rejected for M9-13: not in the existing stack (engineering_rules §10 requires justification + ADR for new deps), native build/maintenance burden, and no deploy story this milestone. Revisit when the hardened service decision is made.

**WASM sandbox now.** Rejected: no cross-language (only JS) demand yet, no existing runtime dependency, build complexity disproportionate to M9 scope.

**Vendor sandbox / separate service.** Rejected for M9-13: new deploy target and a network hop per node execution; correct when the platform has enough CODE usage to pay for the latency. Documented as the Phase 3 destination.
