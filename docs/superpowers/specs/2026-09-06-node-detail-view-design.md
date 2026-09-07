# AF-UX-15 · Node Detail View — design

**Date:** 2026-09-06
**Status:** Approved design, not yet implemented
**Branch:** `af-ux-15-node-detail-view`
**Supersedes:** the side-panel form shipped by AF-M1-06
**Grounded in:** `src/features/editor/**`, `src/features/workflows/server/{routers,test-run}.ts`,
`src/inngest/functions.ts`, `src/nodes/types.ts` — every claim below was read in the
source at time of writing.

---

## 1. Problem

Node configuration today is a 360px `<aside>` pinned to the right edge of the canvas
(`src/features/editor/components/node-config-panel.tsx`, 992 lines). Everything is one
vertical stack: deprecation notice, account requirement, Name, Enabled, Notes, cost
estimate, the schema-driven fields, a collapsed `<details>` of run settings, and — for
`WEBHOOK_TRIGGER` only — a webhook payload tester at the very bottom.

Three problems follow from the shape:

1. **No data context.** The user configures a node against an imagined payload. Nothing
   in the panel shows what actually arrives at the node or what it produces. Verifying a
   change means leaving the editor entirely: `Test node` fires a run and
   `useTestWorkflow` navigates to `/executions/<id>`, losing canvas position, selection,
   and any unsaved draft context.
2. **Everything competes for one narrow column.** Retries and timeouts are hidden in a
   `<details>` specifically so they cannot push a node's real config below the fold
   (AF-M9-06). That is a workaround for the width, not a preference.
3. **Declared affordances go unrendered.** `NodeDefinition.docsUrl` has existed since
   AF-M1-01 with the comment "Docs link rendered in the config panel"
   (`src/nodes/types.ts`). No panel renders it.

`docs/planning/design_recommendations.md` §11.2 names this directly: *"Spend the next
effort on the editor, not the runtime."*

## 2. Goals

- Replace the side panel with a centred modal detail view laid out as three resizable
  columns: **Input | Parameters·Settings | Output**.
- Show the node's **real** resolved input and real output, produced by an actual engine
  run, without leaving the editor.
- Give run settings enough room to stop being collapsed.
- Render `docsUrl` and the node type version.

## 3. Non-goals

Explicitly out of scope; each is a later task if wanted:

- Drag-a-field-from-Input-into-a-parameter to author a `{{$json.x}}` expression.
- Pinned / mock data on a node.
- Per-item navigation ("item 3 of 40") and schema view mode.
- Migrating off polling onto the run-scoped realtime channel (that is AF-UX-07 → AF-UX-09).
- Any change to the field editors themselves — they move file, unmodified.

## 4. Interaction model

### 4.1 Opening and closing

`selectedNodeIdAtom` and "which node is being configured" stop being the same thing. A
new `openNodeIdAtom` is added to `src/features/editor/store/atoms.ts`.

| Gesture | Effect |
|---|---|
| Single click a node | Selects only. Canvas stays clear; drag, delete, multi-select behave as today. |
| Double click a node | Sets `openNodeIdAtom` — the view opens. Wired via `<ReactFlow onNodeDoubleClick>`. |
| `Enter` with exactly one node selected | Same as double click. |
| `Esc`, header `×`, or backdrop click | Clears `openNodeIdAtom`. |

`selectedNodeIdAtom` keeps its current job, so `TestSelectedNodeButton` and the rest of
the bottom bar are untouched.

### 4.2 Undo/redo while open

Graph undo/redo is **suppressed** while the view is open — `openNodeId !== null` joins
`pendingDrop !== null || nodeSelectorOpen` in the `useGraphHistory({ disabled })` call in
`editor.tsx`.

`useGraphHistory` already ignores Ctrl+Z when focus is in an `INPUT`/`TEXTAREA`/`SELECT`,
so the shortcut only fires when focus sits on the dialog root — which is exactly where it
sits immediately after opening. An undo that mutates a canvas the user cannot see, because
a modal covers it, is worse than no undo.

Config edits still commit to history through `patchSelectedNode` with
`CONFIG_TYPING_FOLD_MS`. Closing the view and pressing Ctrl+Z therefore undoes the whole
editing burst as one step, which is a better granularity than today's.

### 4.3 Layout

`<Dialog>` (`src/components/ui/dialog.tsx`) with content sized
`w-[min(1400px,95vw)] h-[min(860px,90vh)]`, holding a horizontal `ResizablePanelGroup`
(`src/components/ui/resizable.tsx`) at 30 / 40 / 30 with `ResizableHandle withHandle`
between panes.

Below `1024px` the three panes collapse into three tabs (Input · Parameters · Output)
rendered by the same components.

## 5. Regions

### 5.1 Header

```
[logo|icon]  [editable name]                              [Docs] [x]
```

- Icon resolves `definition.logo` first, falling back to the lucide `definition.icon` —
  the existing precedent from AF-M10-35.
- The name is a borderless inline `<input>` writing `node.name`, placeholder
  `definition.label`. This removes the Name field from the form entirely.
- The docs link renders `definition.docsUrl` in a new tab; hidden when the definition
  declares none.

### 5.2 Centre — Parameters tab

In order: deprecation notice → account requirement → `<NodeConfigForm>` → cost estimate.

All four already exist and move across unchanged. `NodeConfigForm` is the extracted,
byte-identical schema-driven form.

### 5.3 Centre — Settings tab

Un-collapsed, one per row: **Enabled · Notes · Max attempts · Retry backoff (ms) ·
Attempt timeout (ms) · Continue on fail**. The inherited-value placeholders and the
delete-the-override-on-empty semantics from AF-M9-06 are preserved exactly — only the
`<details>` wrapper is dropped.

Footer line: `{definition.label} node version {definition.version}`.

### 5.4 Execute step button

Sits top-right of the tab bar, visible from both tabs. Disabled while a step run is in
flight. See §6.

### 5.5 Left — Input pane

Resolution order:

1. A step run has completed in this view **and produced a `NodeExecution` row for this
   node** → that node's `NodeExecution.input`.
2. No run yet, or the run failed upstream and never reached this node → empty state:
   *"No input data yet — execute this step to pull data through from the previous node."*
   When the run did happen but failed before reaching this node, the empty state names the
   upstream node that failed rather than reading as "never run".
3. The node is a **trigger** (`definition.category === "TRIGGER"`) → there is no input by
   definition. The pane instead holds the trigger's own test affordance, mirroring the
   reference design's *"Pull in a test form submission"*. For `WEBHOOK_TRIGGER` this is
   the existing `WebhookTester`, relocated here from the bottom of the old panel. Every
   other trigger gets the prompt plus an Execute step call to action.

### 5.6 Right — Output pane

| State | Rendering |
|---|---|
| Idle | *"Execute this step to see output."* |
| Running | Spinner + *"Executing…"* |
| Success | `<DataViewer>` over `NodeExecution.output`, item count, and a stats line built from `durationMs`, `tokensIn`, `tokensOut`, `costUsd` — all already persisted per node execution. |
| Failed | `NodeExecution.error` in a destructive block. `skipReason` when the node was skipped. |

### 5.7 DataViewer

One shared component behind both panes. Toggle between **Table** and **JSON**. Table mode
renders an array of flat objects as columns and falls back to JSON for anything it cannot
tabulate. JSON mode is a read-only pretty-printed block. No new dependency — this is a
`<pre>` and a `<table>`.

## 6. Execute step — what actually runs

### 6.1 The problem with today's semantic

`buildNodeTestRunPlan` (`src/features/workflows/server/test-run.ts`) computes
`skipNodes = computeSkipNodes(graph, targetNodeId)`, which skips **every node that
topologically sorts before the target**. A single-node test run therefore gives the target
no input at all. That is correct for the bottom-bar `Test node` button and useless for a
view whose left column is supposed to show input.

### 6.2 The change

`workflows.testRun` gains `mode: z.enum(["node", "upTo"]).default("node")`.

- `"node"` — today's behaviour, unchanged. `TestSelectedNodeButton` sends nothing and gets
  the default.
- `"upTo"` — a new `buildRunToNodePlan(graph, targetNodeId)` returning
  `{ graphSnapshot, skipNodes: [], endAfterNodeId: targetNodeId }`. The run starts at the
  trigger and stops after the target.

`endAfterNodeId` is already honoured independently of `skipNodes` — `src/inngest/functions.ts`
stops scheduling on it at two call sites. No engine change is required.

The detail view always sends `"upTo"`. That is what populates the Input pane.

### 6.3 useStepRun(workflowId, nodeId)

New hook in `src/features/editor/hooks/use-step-run.ts`.

1. Fires `workflows.testRun` with the current canvas draft, `testNodeId: nodeId`,
   `mode: "upTo"`. It must **not** navigate — today's `useTestWorkflow` does
   `router.push('/executions/<id>')` in `onSuccess`. Extract the raw mutation and keep
   `useTestWorkflow` as the navigating wrapper the bottom bar still uses.
2. Holds the returned `execution.id`.
3. Polls `executions.getOne` on a `refetchInterval` until `status` leaves `RUNNING` —
   terminal is any of `SUCCESS`, `FAILED`, `QUOTA_EXCEEDED`, `CANCELLED`, `TIMED_OUT`
   (`ExecutionStatus`, `prisma/schema.prisma`) — then stops polling. The interval is
   cleared on unmount, so closing the view mid-run does not leave a poll running.
4. Selects `nodeExecutions.find(ne => ne.nodeId === nodeId)` and returns
   `{ run, input, output, status, error, isRunning, execute }`.

**Why polling, not realtime.** The run-scoped `execution:<id>` channel is AF-UX-07, which
is unstarted. Blocking this view on it would serialise two independent pieces of work.
Migrating the hook to the channel once AF-UX-09 lands is a contained change behind the
hook's return type.

## 7. Bug this path forces

`buildTestGraph` reads `n.disabled` to mark nodes the engine must skip. But
`takeDraftNodes` in `test-workflow-button.tsx` sends only `{ id, type, data }`, and the
`testRun` input schema declares only those three keys — Zod strips the rest. **`disabled`
is therefore always `false` in every test run, and a disabled node runs anyway.**

Fixed here rather than filed, because the detail view puts an Enabled toggle inches from an
Execute button, where the discrepancy becomes visible:

- `src/features/workflows/server/routers.ts` — add `disabled: z.boolean().optional()` to
  the node schema.
- `src/features/editor/components/test-workflow-button.tsx` — carry `disabled` in
  `takeDraftNodes`.

## 8. Files

```
src/features/editor/
  components/
    node-config-form.tsx           NEW - extracted verbatim from node-config-panel.tsx:
                                   CronPreview, baseFieldClass, FieldEditor,
                                   ListFieldEditor, FieldListEditor, NodeConfigForm.
                                   `baseFieldClass` becomes an export: the header name
                                   input and every Settings-tab field need it too.
    node-detail-view/
      node-detail-view.tsx         NEW - Dialog + ResizablePanelGroup + tab state
      ndv-header.tsx               NEW - icon, editable name, docs link, close
      ndv-parameters-tab.tsx       NEW
      ndv-settings-tab.tsx         NEW - absorbs RunSettings, un-collapsed
      input-pane.tsx               NEW - action input / trigger affordance / WebhookTester
      output-pane.tsx              NEW
      data-viewer.tsx              NEW - Table / JSON toggle
    node-config-panel.tsx          DELETED
    editor.tsx                     onNodeDoubleClick, openNodeIdAtom, history disabled
    test-workflow-button.tsx       carry `disabled`
  hooks/use-step-run.ts            NEW
  store/atoms.ts                   + openNodeIdAtom

src/features/workflows/
  server/test-run.ts               + buildRunToNodePlan
  server/routers.ts                + mode, + disabled on the node schema
  hooks/use-workflows.ts           split the raw testRun mutation from the navigating wrapper
```

Every new file is single-purpose and small enough to hold in view at once, per the
placement rule in `AGENTS.md` §2.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Node deleted while its view is open | `openNodeIdAtom` no longer resolves to a node; the view closes. |
| Unknown node type | The view does not open — same guard as today's `selectedDefinition` lookup, including the `INITIAL` → `MANUAL_TRIGGER` alias. |
| Graph fails validation on Execute step | `testRun` throws `BAD_REQUEST` with the validation message; surfaced in the Output pane as an error, not a toast that vanishes. |
| Node output exceeds `MAX_NODE_OUTPUT_BYTES` | The run fails loudly per ADR-0018; the Output pane shows that error verbatim. No client-side truncation. |
| Definition has no config fields | Parameters tab renders only the notices; the form is empty rather than absent. |
| `UnsupportedConfigFieldError` | Unchanged — the loud error box from AF-M1-06 still renders inside the Parameters tab. |
| Execute step on a trigger | `buildRunToNodePlan` with a trigger target has nothing upstream, so it is equivalent to running the trigger alone. Correct by construction. |
| Two step runs in quick succession | The button is disabled while `isRunning`; the second click cannot fire. |

## 10. Testing

Per `docs/engineering/testing_strategy.md` §3.

**Moved unchanged:** `node-config-panel.dom.test.tsx` splits. Every `NodeConfigForm` test
becomes `node-config-form.dom.test.tsx` with no assertion changes — a diff that only
renames is the evidence the field editors were not touched.

**New DOM tests** (`node-detail-view.dom.test.tsx`):
- double click opens; `Esc` closes; single click does not open
- Parameters / Settings tab switch preserves entered values
- Output pane renders each of idle / running / success / failed
- Input pane renders the trigger affordance for a `TRIGGER` node and the empty state for an
  action node
- the docs link renders when `docsUrl` is declared and is absent when not
- editing the header name patches `node.name`

**New unit tests** (`test-run.test.ts`):
- `buildRunToNodePlan` returns `skipNodes: []` and `endAfterNodeId: target`
- it still rejects an invalid graph through `assertValidGraph`
- `mode: "node"` is the default, so an absent `mode` plans identically to today

**Regression test** (`test-run.test.ts`): a draft containing a `disabled` node produces a
graph whose node carries `disabled: true` — the §7 bug, locked.

## 11. Acceptance criteria

- [ ] Double click (or Enter on a selected node) opens the detail view; single click only selects
- [ ] `Esc`, close button, and backdrop close it; graph undo/redo is inert while it is open
- [ ] Three resizable columns above 1024px; three tabs below
- [ ] Header shows logo/icon, an editable name, a docs link when `docsUrl` is declared, and a close button
- [ ] Parameters tab renders deprecation, account requirement, the schema-driven form, and the cost estimate
- [ ] Settings tab renders Enabled, Notes, and all four run-policy fields un-collapsed, plus the version line
- [ ] Execute step runs from the trigger through this node and never navigates away
- [ ] Output pane shows real `NodeExecution` output, duration, tokens and cost on success, and the error on failure
- [ ] Input pane shows the node's real resolved input; trigger nodes show a trigger affordance instead
- [ ] `WEBHOOK_TRIGGER`'s payload tester is reachable from the Input pane
- [ ] A disabled node is skipped by a test run
- [ ] `TestWorkflowButton` / `TestSelectedNodeButton` behaviour is unchanged
- [ ] `node-config-panel.tsx` is deleted; no import of it remains
