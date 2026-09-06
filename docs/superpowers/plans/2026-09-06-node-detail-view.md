# Node Detail View (AF-UX-15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 360px side-panel node config form with a centred modal detail view laid out as three resizable columns — Input | Parameters·Settings | Output — that runs the workflow up to the selected node and shows its real input and output without leaving the editor.

**Architecture:** The schema-driven field editors are extracted unchanged into `node-config-form.tsx` and reused. A new `node-detail-view/` directory holds the modal shell and its six single-purpose children. A new `"upTo"` mode on the existing `workflows.testRun` procedure plans a run from the trigger through the target node (`skipNodes: []`, `endAfterNodeId: target`), which the engine already supports. A `useStepRun` hook fires that mutation without navigating and polls `executions.getOne` until the run reaches a terminal status.

**Tech Stack:** Next.js (App Router), React 19, TypeScript, tRPC + TanStack Query, jotai, @xyflow/react, Radix (shadcn `dialog`/`tabs`/`resizable`), Zod, Prisma, Inngest, Vitest (`unit` + `dom` projects), Biome.

**Spec:** `docs/superpowers/specs/2026-09-06-node-detail-view-design.md`

## Global Constraints

- **Branch:** `af-ux-15-node-detail-view`, already created, based on `origin/main`. Do not rebase.
- **Read before first edit:** `docs/engineering/engineering_rules.md`.
- **Test commands:** `npm test` runs everything. Target one project with `npx vitest run --project unit <path>` or `--project dom <path>`. A `*.dom.test.tsx` file runs in the `dom` project (jsdom); every other `*.test.ts` runs in `unit` (node).
- **Lint:** `npm run lint` (Biome). It must be clean before every commit.
- **Any component calling `useTRPC()` must be wrapped in `TRPCTestProvider`** (`src/trpc/test-provider.tsx`) in DOM tests. `NodeConfigForm` does, via its credential picker.
- **Never hand-edit `src/components/ui/*`** — those are shadcn-generated (AGENTS.md §2).
- **No silent failures, no `catch {}`** — a swallowed error is a rule violation, not a style choice.
- **Commit message trailer** on every commit: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Do not touch** `src/inngest/functions.ts`, `src/engine/**`, or any `src/nodes/**/execute.ts`. This plan requires no engine change.

---

### Task 1: `buildRunToNodePlan` + `mode` on `testRun`

Today `buildNodeTestRunPlan` skips every node upstream of the target, so a single-node test run hands the target no input. The detail view needs the input, so it needs a second plan shape: run from the trigger, stop after the target.

**Files:**
- Modify: `src/features/workflows/server/test-run.ts` (add after `buildNodeTestRunPlan`, ~line 125)
- Modify: `src/features/workflows/server/routers.ts:122-165` (the `testRun` procedure)
- Test: `src/features/workflows/server/test-run.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `buildRunToNodePlan(graph: TestGraph, targetNodeId: string): TestRunPlan`. `workflows.testRun` accepts `mode?: "node" | "upTo"`, defaulting to `"node"`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/workflows/server/test-run.test.ts`. The `linearGraph()`, `trigger`, `setA`, `target` and `tail` fixtures already exist at the top of that file — do not redefine them. Add `buildRunToNodePlan` to the existing import block at the top of the file.

```ts
describe("buildRunToNodePlan (AF-UX-15, run-up-to)", () => {
  it("runs every upstream node and stops after the target", () => {
    const plan = buildRunToNodePlan(linearGraph(), target.id);
    // The whole point: nothing is skipped, so the target receives real input.
    expect(plan.skipNodes).toEqual([]);
    expect(plan.endAfterNodeId).toBe(target.id);
    expect(plan.skipReason).toBeUndefined();
  });

  it("carries the whole graph in the snapshot", () => {
    const plan = buildRunToNodePlan(linearGraph(), target.id);
    expect(plan.graphSnapshot.nodes).toHaveLength(4);
  });

  it("targeting the trigger runs it alone", () => {
    const plan = buildRunToNodePlan(linearGraph(), trigger.id);
    expect(plan.skipNodes).toEqual([]);
    expect(plan.endAfterNodeId).toBe(trigger.id);
  });

  it("throws when the target does not exist in the draft", () => {
    expect(() => buildRunToNodePlan(linearGraph(), "missing")).toThrow(
      TestRunError,
    );
    expect(() => buildRunToNodePlan(linearGraph(), "missing")).toThrow(
      /not found/,
    );
  });

  it("rejects an invalid draft with a clear error", () => {
    const graph: TestGraph = {
      nodes: [trigger, { ...target, type: "SCHEDULE_TRIGGER" }],
      connections: [],
    };
    expect(() => buildRunToNodePlan(graph, target.id)).toThrow(TestRunError);
    expect(() => buildRunToNodePlan(graph, target.id)).toThrow(
      /Multiple trigger/i,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project unit src/features/workflows/server/test-run.test.ts
```

Expected: FAIL — `buildRunToNodePlan is not exported by ./test-run` (an import error, so the whole file fails to collect).

- [ ] **Step 3: Implement `buildRunToNodePlan`**

Add to `src/features/workflows/server/test-run.ts`, directly after `buildNodeTestRunPlan` and before `assertValidGraph`:

```ts
/**
 * Plan a "run up to this node" test run (AF-UX-15): every node from the
 * trigger through `targetNodeId` executes, and the engine stops scheduling
 * straight after the target.
 *
 * Distinct from `buildNodeTestRunPlan`, which skips every upstream node and
 * therefore hands the target no input at all. The node detail view's Input
 * pane has nothing to show under that policy, so it plans through this one.
 * `endAfterNodeId` is honoured by the runner independently of `skipNodes`,
 * so an empty skip list still stops the run at the target.
 */
export function buildRunToNodePlan(
  graph: TestGraph,
  targetNodeId: string,
): TestRunPlan {
  const target = graph.nodes.find((n) => n.id === targetNodeId);
  if (!target) {
    throw new TestRunError(`Node "${targetNodeId}" not found in the draft`);
  }

  assertValidGraph(graph);

  return {
    graphSnapshot: graph,
    skipNodes: [],
    endAfterNodeId: targetNodeId,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --project unit src/features/workflows/server/test-run.test.ts
```

Expected: PASS — all tests in the file, including the five new ones.

- [ ] **Step 5: Wire `mode` into the router**

In `src/features/workflows/server/routers.ts`, add `buildRunToNodePlan` to the existing import from `./test-run`. Then add the `mode` field to the `testRun` input object, immediately after `testNodeId`:

```ts
        testNodeId: z.string().min(1).max(64).optional(),
        /**
         * AF-UX-15. "node" is the bottom-bar Test-node semantic: run only the
         * target, skipping everything upstream. "upTo" runs the chain from the
         * trigger through the target, which is what gives the node detail
         * view's Input pane something real to show. Defaults to "node" so
         * every existing caller is unchanged.
         */
        mode: z.enum(["node", "upTo"]).default("node"),
```

And replace the plan selection (currently `plan = input.testNodeId ? buildNodeTestRunPlan(...) : buildTestRunPlan(graph)`) with:

```ts
        if (!input.testNodeId) {
          plan = buildTestRunPlan(graph);
        } else if (input.mode === "upTo") {
          plan = buildRunToNodePlan(graph, input.testNodeId);
        } else {
          plan = buildNodeTestRunPlan(graph, input.testNodeId);
        }
```

- [ ] **Step 6: Verify the whole suite and lint**

```bash
npm test
```

Expected: PASS, with the same count as before plus 5.

```bash
npm run lint
```

Expected: no diagnostics.

- [ ] **Step 7: Commit**

```bash
git add src/features/workflows/server/test-run.ts src/features/workflows/server/test-run.test.ts src/features/workflows/server/routers.ts
git commit -m "feat(workflows): run-up-to-node test plan (AF-UX-15)

buildNodeTestRunPlan skips every upstream node, so the target runs with no
input. The node detail view needs that input, so add buildRunToNodePlan
(skipNodes: [], endAfterNodeId: target) behind a new testRun mode. Default
stays \"node\", so the bottom-bar Test node button is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `disabled` reaches the test run

`buildTestGraph` reads `n.disabled` to mark nodes the engine must skip, but the `testRun` input schema declares only `{ id, type, data }` and Zod strips unknown keys — so `disabled` is always `false` and a disabled node runs anyway in every test run today. The detail view puts an Enabled toggle inches from an Execute button, which makes the discrepancy visible.

**Files:**
- Modify: `src/features/workflows/server/test-run.ts` (add exported schemas near the `DraftNode`/`DraftEdge` types, ~line 30)
- Modify: `src/features/workflows/server/routers.ts:124-142` (use the exported schemas)
- Modify: `src/features/editor/components/test-workflow-button.tsx:11-16`
- Test: `src/features/workflows/server/test-run.test.ts` (append)

**Interfaces:**
- Consumes: `TestRunPlan` shape from Task 1 (unchanged).
- Produces: `draftNodeSchema` and `draftEdgeSchema` (Zod schemas exported from `test-run.ts`), whose parsed output matches the existing `DraftNode` / `DraftEdge` types.

- [ ] **Step 1: Write the failing test**

Append to `src/features/workflows/server/test-run.test.ts`, and add `draftNodeSchema` to the import block at the top:

```ts
describe("draftNodeSchema (AF-UX-15)", () => {
  it("preserves `disabled` so buildTestGraph can skip the node", () => {
    // The bug this locks: the router's inline schema declared only
    // id/type/data, Zod stripped `disabled`, and every disabled node ran.
    const parsed = draftNodeSchema.parse({
      id: "n2",
      type: "SET",
      data: {},
      disabled: true,
    });
    expect(parsed.disabled).toBe(true);
  });

  it("leaves `disabled` undefined when the client omits it", () => {
    const parsed = draftNodeSchema.parse({ id: "n1", type: "SET" });
    expect(parsed.disabled).toBeUndefined();
  });

  it("a parsed disabled node reaches the snapshot as disabled", () => {
    const graph = buildTestGraph(
      [
        draftNodeSchema.parse({ id: "n1", type: "MANUAL_TRIGGER" }),
        draftNodeSchema.parse({ id: "n2", type: "SET", disabled: true }),
      ],
      [{ source: "n1", target: "n2" }],
    );
    expect(graph.nodes[0].disabled).toBe(false);
    expect(graph.nodes[1].disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --project unit src/features/workflows/server/test-run.test.ts
```

Expected: FAIL — `draftNodeSchema is not exported by ./test-run`.

- [ ] **Step 3: Export the schemas from `test-run.ts`**

Add `import { z } from "zod";` to the top of `src/features/workflows/server/test-run.ts`, then add these directly beneath the `DraftEdge` type:

```ts
/**
 * Wire schema for a canvas node arriving at `workflows.testRun` (AF-UX-15).
 *
 * Lives here, next to `DraftNode`, rather than inline in the router, because
 * the two must not drift: `buildTestGraph` reads `disabled`, and while the
 * router declared only id/type/data Zod stripped it — so every disabled node
 * ran in every test run. Keeping the schema beside the type it mirrors makes
 * that class of omission a unit test rather than a production surprise.
 */
export const draftNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(128),
  data: z.record(z.string(), z.unknown()).optional(),
  disabled: z.boolean().optional(),
});

export const draftEdgeSchema = z.object({
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  sourceHandle: z.string().max(128).nullish(),
  targetHandle: z.string().max(128).nullish(),
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --project unit src/features/workflows/server/test-run.test.ts
```

Expected: PASS.

- [ ] **Step 5: Use the schemas in the router**

In `src/features/workflows/server/routers.ts`, add `draftEdgeSchema, draftNodeSchema` to the existing import from `./test-run`, then replace the inline `nodes` and `edges` schemas in the `testRun` input with:

```ts
        nodes: z.array(draftNodeSchema).min(1),
        edges: z.array(draftEdgeSchema),
```

- [ ] **Step 6: Send `disabled` from the client**

In `src/features/editor/components/test-workflow-button.tsx`, replace the `@xyflow/react` `Node` import with the editor's own node type and carry `disabled` through:

```ts
import { getDefaultStore } from "jotai";
import { FlaskConicalIcon, MousePointerClickIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTestWorkflow } from "@/features/workflows/hooks/use-workflows";
import { type EditorNode, edgesAtom, nodesAtom } from "../store/atoms";

const jotaiStore = getDefaultStore();

// `disabled` is load-bearing: buildTestGraph reads it to mark the nodes the
// engine must skip. Dropping it here silently ran every disabled node.
const takeDraftNodes = () =>
  jotaiStore
    .get(nodesAtom)
    .filter((n): n is EditorNode & { type: string } => Boolean(n.type))
    .map((n) => ({
      id: n.id,
      type: n.type,
      data: n.data,
      disabled: n.disabled,
    }));
```

Leave the rest of the file unchanged.

- [ ] **Step 7: Verify the whole suite, types and lint**

```bash
npm test
```

Expected: PASS.

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run lint
```

Expected: no diagnostics.

- [ ] **Step 8: Commit**

```bash
git add src/features/workflows/server/test-run.ts src/features/workflows/server/test-run.test.ts src/features/workflows/server/routers.ts src/features/editor/components/test-workflow-button.tsx
git commit -m "fix(workflows): disabled nodes were running in every test run

buildTestGraph reads node.disabled, but takeDraftNodes never sent it and the
testRun input schema never declared it, so Zod stripped it and every disabled
node ran. Move the draft node/edge schemas next to the types they mirror,
export them, and carry disabled from the canvas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract `node-config-form.tsx`

A pure move. Nothing about the field editors changes — the value of this task is that the *next* seven tasks can be reviewed without the 570 lines of field-editor code in the diff.

**Files:**
- Create: `src/features/editor/components/node-config-form.tsx`
- Create: `src/features/editor/components/node-config-form.dom.test.tsx`
- Modify: `src/features/editor/components/node-config-panel.tsx` (delete the moved code, import it back)
- Modify: `src/features/editor/components/node-config-panel.dom.test.tsx` (remove the moved describes)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `NodeConfigForm({ definition: NodeDefinition, data: Record<string, unknown>, onDataChange: (next: Record<string, unknown>) => void })` — unchanged signature.
  - `baseFieldClass(hasError?: boolean): string` — **newly exported**; the detail view's header name input and every Settings-tab field need it.
  - `CronPreview({ cronStr: string })` — stays internal to the new file.

- [ ] **Step 1: Create `node-config-form.tsx` by moving code**

Create `src/features/editor/components/node-config-form.tsx` containing, in this order, moved verbatim from `node-config-panel.tsx`:

1. The `"use client";` directive
2. Imports: `CronExpressionParser` from `cron-parser`; `useCallback, useEffect, useId, useMemo, useRef, useState` from `react`; `CredentialField`; the four `config-schema` imports; `NodeDefinition` type
3. `CronPreview` (lines 43-79)
4. `type FieldValue` (line 81)
5. `baseFieldClass` (lines 83-90) — **add `export`**
6. `FieldEditor` (lines 92-259)
7. `type KVRow`, `toRows`, `fromRows`, `ListFieldEditor` (lines 261-377)
8. `type FieldRow`, `toFieldRows`, `fieldRowPresent`, `rowCellEditor`, `FieldListEditor` (lines 379-580)
9. `NodeConfigForm` (lines 582-652)

Add this module docstring at the top, under the `"use client"` directive:

```tsx
/**
 * Schema-driven node configuration form (AF-M1-06).
 *
 * Extracted from `node-config-panel.tsx` by AF-UX-15 with no behavioural
 * change: the panel that used to wrap it was replaced by the node detail
 * view, and the field editors had no reason to move with it. `baseFieldClass`
 * is exported because the detail view's header and Settings tab render inputs
 * that must match these.
 */
```

Do not change a single line of the moved code beyond adding `export` to `baseFieldClass`.

- [ ] **Step 2: Re-import into `node-config-panel.tsx`**

Delete everything listed in Step 1 from `node-config-panel.tsx` and replace it with:

```tsx
import {
  baseFieldClass,
  NodeConfigForm,
} from "@/features/editor/components/node-config-form";
```

Remove the now-unused imports from that file (`CronExpressionParser`, `CredentialField`, the `config-schema` imports, and any of `useCallback`/`useMemo`/`useRef` that nothing left in the file uses). Keep `NodeConfigPanel`, `RunSettings`, `WebhookTester` and `EDITOR_RUN_DEFAULTS`.

Do **not** re-export `NodeConfigForm` from the panel. Nothing outside the panel and its own test ever imported it (`editor.tsx` imports only `NodeConfigPanel`), and Step 3 repoints the test — a re-export here would be dead code that Task 10 deletes anyway.

- [ ] **Step 3: Split the test file**

Create `src/features/editor/components/node-config-form.dom.test.tsx`. Move into it, unchanged, every `describe` block from `node-config-panel.dom.test.tsx` that renders `NodeConfigForm`. Copy across the file's shared preamble it needs — the `render` helper wrapping in `TRPCTestProvider`, `httpDefinition`, `httpNode`, and any fixture those describes reference. Change only the import path:

```tsx
import { NodeConfigForm } from "./node-config-form";
```

Delete those same `describe` blocks from `node-config-panel.dom.test.tsx`, and delete any fixture there that nothing remaining references.

**No assertion may change.** A diff that only moves lines is the evidence the field editors were not touched.

- [ ] **Step 4: Run both DOM test files**

```bash
npx vitest run --project dom src/features/editor/components/node-config-form.dom.test.tsx src/features/editor/components/node-config-panel.dom.test.tsx
```

Expected: PASS, with the same total test count as `node-config-panel.dom.test.tsx` alone had before the split.

- [ ] **Step 5: Verify the whole suite, types and lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: PASS, no type errors, no diagnostics.

- [ ] **Step 6: Commit**

```bash
git add src/features/editor/components/node-config-form.tsx src/features/editor/components/node-config-form.dom.test.tsx src/features/editor/components/node-config-panel.tsx src/features/editor/components/node-config-panel.dom.test.tsx
git commit -m "refactor(editor): extract NodeConfigForm from the config panel

Pure move, no behavioural change. The panel is about to be replaced by the
node detail view (AF-UX-15) and the schema-driven field editors have no
reason to move with it. baseFieldClass becomes an export - the detail view's
header input and Settings fields must match these.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `DataViewer`

The shared read-only renderer behind both the Input and Output panes: a Table/JSON toggle over arbitrary node payloads.

**Files:**
- Create: `src/features/editor/components/node-detail-view/data-viewer.tsx`
- Test: `src/features/editor/components/node-detail-view/data-viewer.dom.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `DataViewer({ value: unknown, label: string })` — `label` prefixes the toggle's accessible names so two viewers on one screen stay distinguishable.
  - `toTableRows(value: unknown): Record<string, unknown>[] | null` — exported for unit testing; `null` means "not tabulatable, render JSON".

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/components/node-detail-view/data-viewer.dom.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataViewer, toTableRows } from "./data-viewer";

describe("toTableRows", () => {
  it("tabulates an array of flat objects", () => {
    expect(toTableRows([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("wraps a single flat object as one row", () => {
    expect(toTableRows({ a: 1, b: "x" })).toEqual([{ a: 1, b: "x" }]);
  });

  it("refuses a primitive", () => {
    expect(toTableRows("hello")).toBeNull();
    expect(toTableRows(42)).toBeNull();
  });

  it("refuses null and undefined", () => {
    expect(toTableRows(null)).toBeNull();
    expect(toTableRows(undefined)).toBeNull();
  });

  it("refuses an array of primitives", () => {
    expect(toTableRows([1, 2, 3])).toBeNull();
  });

  it("refuses an empty array", () => {
    expect(toTableRows([])).toBeNull();
  });
});

describe("DataViewer", () => {
  it("defaults to the table view when the value tabulates", () => {
    render(<DataViewer value={[{ name: "Ada" }]} label="Output" />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("Ada")).toBeTruthy();
  });

  it("switches to JSON and back", () => {
    render(<DataViewer value={[{ name: "Ada" }]} label="Output" />);
    fireEvent.click(screen.getByRole("button", { name: "Output as JSON" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/"name": "Ada"/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Output as table" }));
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("falls back to JSON with no table toggle when the value cannot tabulate", () => {
    render(<DataViewer value="just a string" label="Output" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Output as table" }),
    ).toBeNull();
    expect(screen.getByText(/just a string/)).toBeTruthy();
  });

  it("renders a nested cell as JSON rather than [object Object]", () => {
    render(<DataViewer value={[{ user: { id: 7 } }]} label="Output" />);
    expect(screen.getByText('{"id":7}')).toBeTruthy();
  });

  it("shows an em dash for a missing cell", () => {
    render(<DataViewer value={[{ a: 1 }, { b: 2 }]} label="Output" />);
    // Row 1 has no `b`, row 2 has no `a` - two blanks.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/data-viewer.dom.test.tsx
```

Expected: FAIL — cannot resolve `./data-viewer`.

- [ ] **Step 3: Implement `DataViewer`**

Create `src/features/editor/components/node-detail-view/data-viewer.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

/**
 * Read-only payload renderer shared by the Input and Output panes (AF-UX-15).
 *
 * Node payloads are arbitrary JSON, so the table view is best-effort: an array
 * of flat objects becomes columns, a single object becomes one row, and
 * anything else falls back to JSON with the toggle hidden rather than
 * rendering an empty table that looks like missing data.
 */

/**
 * Rows for the table view, or `null` when the value cannot be tabulated.
 * A nested value is kept as-is; the cell renderer stringifies it.
 */
export function toTableRows(value: unknown): Record<string, unknown>[] | null {
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.every(isPlainObject)
      ? (value as Record<string, unknown>[])
      : null;
  }
  return isPlainObject(value) ? [value] : null;
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function DataViewer({
  value,
  label,
}: {
  value: unknown;
  label: string;
}) {
  const rows = useMemo(() => toTableRows(value), [value]);
  const [mode, setMode] = useState<"table" | "json">("table");

  const columns = useMemo(() => {
    if (!rows) return [];
    // Union of keys across rows, first-seen order — a node that omits a field
    // on some items must not silently drop the column.
    const seen: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!seen.includes(key)) seen.push(key);
      }
    }
    return seen;
  }, [rows]);

  const showTable = rows !== null && mode === "table";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {rows !== null ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={`${label} as table`}
            aria-pressed={mode === "table"}
            onClick={() => setMode("table")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              mode === "table"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            Table
          </button>
          <button
            type="button"
            aria-label={`${label} as JSON`}
            aria-pressed={mode === "json"}
            onClick={() => setMode("json")}
            className={`rounded-md px-2 py-0.5 text-xs ${
              mode === "json"
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            JSON
          </button>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/30">
        {showTable ? (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                // Node payload rows have no stable id of their own, and the
                // list is never reordered — index is the honest key here.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <tr key={rowIndex} className="even:bg-muted/40">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="border-b border-border/50 px-2 py-1 align-top font-mono"
                    >
                      {cellText(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="overflow-auto p-2 font-mono text-xs leading-relaxed">
            {JSON.stringify(value, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/data-viewer.dom.test.tsx
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/features/editor/components/node-detail-view/data-viewer.tsx src/features/editor/components/node-detail-view/data-viewer.dom.test.tsx
git commit -m "feat(editor): DataViewer for node input/output payloads (AF-UX-15)

Table view for an array of flat objects or a single object; JSON for
everything else, with the toggle hidden rather than showing an empty table
that reads as missing data.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `useStepRun`

Fires a run-up-to-this-node test run without navigating, polls until terminal, and projects the result down to one node's view. The projection and the terminal check are pure functions so they can be unit-tested without a tRPC round trip.

**Files:**
- Create: `src/features/editor/hooks/use-step-run.ts`
- Test: `src/features/editor/hooks/use-step-run.test.ts`
- Modify: `src/features/workflows/hooks/use-workflows.ts:164-179`

**Interfaces:**
- Consumes: `mode: "upTo"` on `workflows.testRun` (Task 1).
- Produces:
  - `isTerminalExecutionStatus(status: string | null | undefined): boolean`
  - `type NodeRunView` — the shape below, consumed by Tasks 8 and 9.
  - `selectNodeRun(execution: ExecutionLike | undefined, nodeId: string): NodeRunView`
  - `useStepRun(workflowId: string, nodeId: string): NodeRunView & { execute: () => void; isRunning: boolean }`
  - `useTestRunMutation()` — the raw, non-navigating mutation, exported from `use-workflows.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/hooks/use-step-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isTerminalExecutionStatus,
  selectNodeRun,
} from "./use-step-run";

const nodeExec = (over: Record<string, unknown> = {}) => ({
  nodeId: "n2",
  nodeName: "SET",
  status: "SUCCESS",
  order: 1,
  input: { a: 1 },
  output: { b: 2 },
  error: null,
  skipReason: null,
  durationMs: 120,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  ...over,
});

describe("isTerminalExecutionStatus", () => {
  it("is false while RUNNING", () => {
    expect(isTerminalExecutionStatus("RUNNING")).toBe(false);
  });

  it("is true for every terminal ExecutionStatus", () => {
    for (const status of [
      "SUCCESS",
      "FAILED",
      "QUOTA_EXCEEDED",
      "CANCELLED",
      "TIMED_OUT",
    ]) {
      expect(isTerminalExecutionStatus(status)).toBe(true);
    }
  });

  it("is false for nothing at all", () => {
    expect(isTerminalExecutionStatus(undefined)).toBe(false);
    expect(isTerminalExecutionStatus(null)).toBe(false);
  });
});

describe("selectNodeRun", () => {
  it("reports idle before any execution exists", () => {
    const view = selectNodeRun(undefined, "n2");
    expect(view.status).toBe("idle");
    expect(view.input).toBeUndefined();
    expect(view.output).toBeUndefined();
  });

  it("reports running while the execution is RUNNING and the node has no row", () => {
    const view = selectNodeRun(
      { status: "RUNNING", error: null, nodeExecutions: [] },
      "n2",
    );
    expect(view.status).toBe("running");
  });

  it("projects a successful node row", () => {
    const view = selectNodeRun(
      { status: "SUCCESS", error: null, nodeExecutions: [nodeExec()] },
      "n2",
    );
    expect(view.status).toBe("success");
    expect(view.input).toEqual({ a: 1 });
    expect(view.output).toEqual({ b: 2 });
    expect(view.durationMs).toBe(120);
  });

  it("projects a failed node row with its error", () => {
    const view = selectNodeRun(
      {
        status: "FAILED",
        error: null,
        nodeExecutions: [
          nodeExec({ status: "FAILED", error: "boom", output: null }),
        ],
      },
      "n2",
    );
    expect(view.status).toBe("failed");
    expect(view.error).toBe("boom");
  });

  it("projects a skipped node row with its reason", () => {
    const view = selectNodeRun(
      {
        status: "SUCCESS",
        error: null,
        nodeExecutions: [
          nodeExec({ status: "SKIPPED", skipReason: "disabled" }),
        ],
      },
      "n2",
    );
    expect(view.status).toBe("skipped");
    expect(view.skipReason).toBe("disabled");
  });

  it("names the upstream node that failed before this one ran", () => {
    // The run failed at n1, so n2 has no row at all. Reporting "never run"
    // here would be a lie the user has to debug twice.
    const view = selectNodeRun(
      {
        status: "FAILED",
        error: "HTTP 500",
        nodeExecutions: [
          nodeExec({
            nodeId: "n1",
            nodeName: "Fetch stats",
            status: "FAILED",
            order: 0,
            error: "HTTP 500",
          }),
        ],
      },
      "n2",
    );
    expect(view.status).toBe("failed");
    expect(view.blockedBy).toBe("Fetch stats");
    expect(view.error).toBe("HTTP 500");
  });

  it("prefers this node's own row over the failed-upstream path", () => {
    const view = selectNodeRun(
      {
        status: "FAILED",
        error: "HTTP 500",
        nodeExecutions: [
          nodeExec({ nodeId: "n1", status: "SUCCESS", order: 0 }),
          nodeExec({ status: "FAILED", error: "mine", order: 1 }),
        ],
      },
      "n2",
    );
    expect(view.blockedBy).toBeNull();
    expect(view.error).toBe("mine");
  });

  it("picks the itemIndex-less row when a fan-out produced several", () => {
    const view = selectNodeRun(
      {
        status: "SUCCESS",
        error: null,
        nodeExecutions: [
          nodeExec({ itemIndex: 0, output: { b: "first" } }),
          nodeExec({ itemIndex: 1, output: { b: "second" } }),
        ],
      },
      "n2",
    );
    // No boundary row exists, so the first item's row stands in rather than
    // the pane showing nothing.
    expect(view.status).toBe("success");
    expect(view.output).toEqual({ b: "first" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project unit src/features/editor/hooks/use-step-run.test.ts
```

Expected: FAIL — cannot resolve `./use-step-run`.

- [ ] **Step 3: Split the raw mutation out of `useTestWorkflow`**

In `src/features/workflows/hooks/use-workflows.ts`, replace the existing `useTestWorkflow` (lines 164-179) with:

```ts
/**
 * Raw test-run mutation with no navigation (AF-UX-15).
 *
 * `useTestWorkflow` pushes to /executions/<id> on success, which is right for
 * the bottom-bar buttons and wrong for the node detail view — the whole point
 * of Execute step is that you do not leave the editor.
 */
export const useTestRunMutation = () => {
  const trpc = useTRPC();
  return useMutation(trpc.workflows.testRun.mutationOptions({}));
};

export const useTestWorkflow = () => {
  const trpc = useTRPC();
  const router = useRouter();

  return useMutation(
    trpc.workflows.testRun.mutationOptions({
      onSuccess: (data) => {
        toast.success("Test run started");
        router.push(`/executions/${data.id}`);
      },
      onError: (error) => {
        toast.error(`Test run failed: ${error.message}`);
      },
    }),
  );
};
```

- [ ] **Step 4: Implement `use-step-run.ts`**

Create `src/features/editor/hooks/use-step-run.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { getDefaultStore } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { edgesAtom, type EditorNode, nodesAtom } from "@/features/editor/store/atoms";
import { useTestRunMutation } from "@/features/workflows/hooks/use-workflows";
import { useTRPC } from "@/trpc/client";

/**
 * Runs the workflow up to one node and projects the result onto that node
 * (AF-UX-15).
 *
 * Polls `executions.getOne` rather than subscribing: the run-scoped realtime
 * channel is AF-UX-07, which is unstarted, and blocking this view on it would
 * serialise two independent pieces of work. Migrating later is contained
 * behind `NodeRunView`.
 */

const jotaiStore = getDefaultStore();

/** Mirrors `ExecutionStatus` in prisma/schema.prisma. */
const TERMINAL_EXECUTION_STATUSES = [
  "SUCCESS",
  "FAILED",
  "QUOTA_EXCEEDED",
  "CANCELLED",
  "TIMED_OUT",
] as const;

export function isTerminalExecutionStatus(
  status: string | null | undefined,
): boolean {
  if (status == null) return false;
  return (TERMINAL_EXECUTION_STATUSES as readonly string[]).includes(status);
}

/** The subset of `executions.getOne` this hook reads. */
export type ExecutionLike = {
  status: string;
  error: string | null;
  nodeExecutions: {
    nodeId: string;
    nodeName: string;
    status: string;
    order: number;
    itemIndex?: number | null;
    input: unknown;
    output: unknown;
    error: string | null;
    skipReason: string | null;
    durationMs: number | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  }[];
};

export type NodeRunView = {
  status: "idle" | "running" | "success" | "failed" | "skipped";
  input: unknown;
  output: unknown;
  error: string | null;
  skipReason: string | null;
  durationMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  /**
   * Name of the upstream node that failed before this one ever ran. Set only
   * when this node has no row of its own; the panes say so rather than
   * claiming the node was never run.
   */
  blockedBy: string | null;
};

const IDLE: NodeRunView = {
  status: "idle",
  input: undefined,
  output: undefined,
  error: null,
  skipReason: null,
  durationMs: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  blockedBy: null,
};

export function selectNodeRun(
  execution: ExecutionLike | undefined,
  nodeId: string,
): NodeRunView {
  if (!execution) return IDLE;

  const rows = execution.nodeExecutions.filter((ne) => ne.nodeId === nodeId);
  // A fan-out writes one row per item (ADR-0021). The boundary row carries no
  // itemIndex; when there is none, the first item stands in so the pane shows
  // something real rather than nothing.
  const row = rows.find((r) => r.itemIndex == null) ?? rows[0];

  if (!row) {
    if (execution.status === "RUNNING") {
      return { ...IDLE, status: "running" };
    }
    // The run finished without ever reaching this node.
    const failedUpstream = execution.nodeExecutions.find(
      (ne) => ne.status === "FAILED",
    );
    if (failedUpstream) {
      return {
        ...IDLE,
        status: "failed",
        error: failedUpstream.error ?? execution.error,
        blockedBy: failedUpstream.nodeName,
      };
    }
    return IDLE;
  }

  const status: NodeRunView["status"] =
    row.status === "SUCCESS"
      ? "success"
      : row.status === "FAILED"
        ? "failed"
        : row.status === "SKIPPED"
          ? "skipped"
          : "running";

  return {
    status,
    input: row.input,
    output: row.output,
    error: row.error,
    skipReason: row.skipReason,
    durationMs: row.durationMs,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    blockedBy: null,
  };
}

export function useStepRun(
  workflowId: string,
  nodeId: string,
): NodeRunView & { execute: () => void; isRunning: boolean } {
  const trpc = useTRPC();
  const testRun = useTestRunMutation();
  const [executionId, setExecutionId] = useState<string | null>(null);

  const { data: execution } = useQuery({
    ...trpc.executions.getOne.queryOptions({ id: executionId ?? "" }),
    enabled: executionId !== null,
    refetchInterval: (query) =>
      isTerminalExecutionStatus(query.state.data?.status) ? false : 2_000,
  });

  const execute = useCallback(() => {
    const nodes = jotaiStore
      .get(nodesAtom)
      .filter((n): n is EditorNode & { type: string } => Boolean(n.type))
      .map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data,
        disabled: n.disabled,
      }));
    if (nodes.length === 0) return;

    setExecutionId(null);
    testRun.mutate(
      {
        id: workflowId,
        nodes,
        edges: jotaiStore.get(edgesAtom),
        testNodeId: nodeId,
        mode: "upTo",
      },
      { onSuccess: (created) => setExecutionId(created.id) },
    );
  }, [nodeId, testRun, workflowId]);

  const view = useMemo(
    () => selectNodeRun(execution as ExecutionLike | undefined, nodeId),
    [execution, nodeId],
  );

  const isRunning =
    testRun.isPending ||
    (executionId !== null && !isTerminalExecutionStatus(execution?.status));

  return {
    ...view,
    // The mutation is in flight, or the run is scheduled but not yet terminal.
    status: isRunning ? "running" : view.status,
    // A rejected mutation (graph validation, quota) never produces an
    // execution, so its message is the only error there is to show.
    error: testRun.error?.message ?? view.error,
    execute,
    isRunning,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --project unit src/features/editor/hooks/use-step-run.test.ts
```

Expected: PASS — 12 tests.

- [ ] **Step 6: Verify types, suite and lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```

Expected: PASS, no type errors, no diagnostics.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/hooks/use-step-run.ts src/features/editor/hooks/use-step-run.test.ts src/features/workflows/hooks/use-workflows.ts
git commit -m "feat(editor): useStepRun - run up to a node without leaving the editor (AF-UX-15)

Splits the raw testRun mutation out of useTestWorkflow, which navigates to
/executions/<id> on success. Polls executions.getOne until terminal and
projects the run onto one node. selectNodeRun and isTerminalExecutionStatus
are pure, so the projection is unit-tested without a round trip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `NdvHeader`

Icon, click-to-edit name, docs link, close button. Renders `definition.docsUrl`, which has been declared on `NodeDefinition` since AF-M1-01 and never rendered anywhere.

**Files:**
- Create: `src/features/editor/components/node-detail-view/ndv-header.tsx`
- Test: `src/features/editor/components/node-detail-view/ndv-header.dom.test.tsx`

**Interfaces:**
- Consumes: `baseFieldClass` from `node-config-form.tsx` (Task 3); `NodeIcon` from `@/components/node-icon` (existing).
- Produces: `NdvHeader({ node: EditorNode, definition: NodeDefinition, onNameChange: (name: string) => void, onClose: () => void })`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/components/node-detail-view/ndv-header.dom.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EditorNode } from "@/features/editor/store/atoms";
import type { NodeDefinition } from "@/nodes/types";
import { NdvHeader } from "./ndv-header";

const definition: NodeDefinition = {
  type: "HTTP_REQUEST",
  category: "ACTION",
  label: "HTTP Request",
  description: "Call an HTTP endpoint.",
  version: 3,
  icon: "Globe",
  inputs: [],
  outputs: [],
  configSchema: z.object({}),
  defaults: {},
};

const node: EditorNode = {
  id: "n1",
  type: "HTTP_REQUEST",
  name: "Fetch stats",
  data: {},
  position: { x: 0, y: 0 },
};

describe("NdvHeader (AF-UX-15)", () => {
  it("shows the node name in an editable field", () => {
    render(
      <NdvHeader
        node={node}
        definition={definition}
        onNameChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Node name") as HTMLInputElement;
    expect(input.value).toBe("Fetch stats");
  });

  it("falls back to the definition label as placeholder when unnamed", () => {
    render(
      <NdvHeader
        node={{ ...node, name: undefined }}
        definition={definition}
        onNameChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Node name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("HTTP Request");
  });

  it("reports name edits", () => {
    const onNameChange = vi.fn();
    render(
      <NdvHeader
        node={node}
        definition={definition}
        onNameChange={onNameChange}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Node name"), {
      target: { value: "Fetch users" },
    });
    expect(onNameChange).toHaveBeenCalledWith("Fetch users");
  });

  it("renders the docs link when the definition declares one", () => {
    render(
      <NdvHeader
        node={node}
        definition={{ ...definition, docsUrl: "https://docs.example.com/http" }}
        onNameChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: /docs/i });
    expect(link.getAttribute("href")).toBe("https://docs.example.com/http");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("omits the docs link when the definition declares none", () => {
    render(
      <NdvHeader
        node={node}
        definition={definition}
        onNameChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("link", { name: /docs/i })).toBeNull();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(
      <NdvHeader
        node={node}
        definition={definition}
        onNameChange={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/ndv-header.dom.test.tsx
```

Expected: FAIL — cannot resolve `./ndv-header`.

- [ ] **Step 3: Implement `NdvHeader`**

Create `src/features/editor/components/node-detail-view/ndv-header.tsx`:

```tsx
"use client";

import { ExternalLinkIcon, XIcon } from "lucide-react";
import { NodeIcon } from "@/components/node-icon";
import type { EditorNode } from "@/features/editor/store/atoms";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Node detail view header (AF-UX-15).
 *
 * The name lives here rather than in the form: it identifies the node being
 * configured, and expressions reference it by display name
 * (`{{$node.[Name].field}}`), so it belongs with the title, not among the
 * node's parameters. `docsUrl` has been on `NodeDefinition` since AF-M1-01
 * with the comment "Docs link rendered in the config panel"; this is the
 * first thing to render it.
 */
export function NdvHeader({
  node,
  definition,
  onNameChange,
  onClose,
}: {
  node: EditorNode;
  definition: NodeDefinition;
  onNameChange: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-muted/60">
        <NodeIcon
          type={definition.type}
          iconName={definition.icon}
          logo={definition.logo}
          label={definition.label}
          className="size-5"
        />
      </div>

      <input
        type="text"
        aria-label="Node name"
        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring/30"
        placeholder={definition.label}
        value={node.name ?? ""}
        onChange={(e) => onNameChange(e.target.value)}
      />

      {definition.docsUrl ? (
        <a
          href={definition.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Docs
          <ExternalLinkIcon className="size-3" />
        </a>
      ) : null}

      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/ndv-header.dom.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/features/editor/components/node-detail-view/ndv-header.tsx src/features/editor/components/node-detail-view/ndv-header.dom.test.tsx
git commit -m "feat(editor): node detail view header (AF-UX-15)

Icon, click-to-edit name, docs link, close. Renders NodeDefinition.docsUrl,
declared since AF-M1-01 and never rendered by any panel until now.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `NdvSettingsTab`

Absorbs `RunSettings` from the old panel and un-collapses it. The `<details>` wrapper existed only because the 360px column had no room; the tab does.

**Files:**
- Create: `src/features/editor/components/node-detail-view/ndv-settings-tab.tsx`
- Test: `src/features/editor/components/node-detail-view/ndv-settings-tab.dom.test.tsx`

**Interfaces:**
- Consumes: `baseFieldClass` from `node-config-form.tsx` (Task 3); `RUN_POLICY_KEY` and `resolveRunPolicy` from `@/nodes/shared/run-policy` (existing).
- Produces: `NdvSettingsTab({ node: EditorNode, definition: NodeDefinition, onNodeChange: (patch: Partial<EditorNode>) => void })`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/components/node-detail-view/ndv-settings-tab.dom.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { EditorNode } from "@/features/editor/store/atoms";
import { RUN_POLICY_KEY } from "@/nodes/shared/run-policy";
import type { NodeDefinition } from "@/nodes/types";
import { NdvSettingsTab } from "./ndv-settings-tab";

const definition: NodeDefinition = {
  type: "HTTP_REQUEST",
  category: "ACTION",
  label: "HTTP Request",
  description: "Call an HTTP endpoint.",
  version: 3,
  icon: "Globe",
  inputs: [],
  outputs: [],
  configSchema: z.object({}),
  defaults: {},
};

const node: EditorNode = {
  id: "n1",
  type: "HTTP_REQUEST",
  name: "Fetch stats",
  data: {},
  position: { x: 0, y: 0 },
};

describe("NdvSettingsTab (AF-UX-15)", () => {
  it("shows run settings without needing a disclosure to be opened", () => {
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={vi.fn()}
      />,
    );
    // The old panel hid these behind <details>; the tab has room.
    expect(screen.getByLabelText("Max attempts")).toBeTruthy();
    expect(screen.getByLabelText("Retry backoff (ms)")).toBeTruthy();
    expect(screen.getByLabelText("Attempt timeout (ms)")).toBeTruthy();
    expect(screen.getByLabelText("Continue on fail")).toBeTruthy();
  });

  it("toggles Enabled through node.disabled", () => {
    const onNodeChange = vi.fn();
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={onNodeChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(onNodeChange).toHaveBeenCalledWith({ disabled: true });
  });

  it("writes notes, and clears them when emptied", () => {
    const onNodeChange = vi.fn();
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={onNodeChange}
      />,
    );
    const notes = screen.getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "calls the stats API" } });
    expect(onNodeChange).toHaveBeenCalledWith({ notes: "calls the stats API" });

    fireEvent.change(notes, { target: { value: "   " } });
    expect(onNodeChange).toHaveBeenCalledWith({ notes: undefined });
  });

  it("placeholders show the inherited value, not a pre-filled one", () => {
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={vi.fn()}
      />,
    );
    const maxAttempts = screen.getByLabelText(
      "Max attempts",
    ) as HTMLInputElement;
    expect(maxAttempts.value).toBe("");
    expect(maxAttempts.placeholder).toBe("Inherits 3");
  });

  it("writes an override into the reserved run-policy key", () => {
    const onNodeChange = vi.fn();
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={onNodeChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Max attempts"), {
      target: { value: "5" },
    });
    expect(onNodeChange).toHaveBeenCalledWith({
      data: { [RUN_POLICY_KEY]: { maxAttempts: 5 } },
    });
  });

  it("clearing the last override deletes the policy key entirely", () => {
    const onNodeChange = vi.fn();
    render(
      <NdvSettingsTab
        node={{ ...node, data: { [RUN_POLICY_KEY]: { maxAttempts: 5 } } }}
        definition={definition}
        onNodeChange={onNodeChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Max attempts"), {
      target: { value: "" },
    });
    // Not `{ _run: {} }` - an empty object would round-trip as a policy.
    expect(onNodeChange).toHaveBeenCalledWith({ data: {} });
  });

  it("shows the node type version", () => {
    render(
      <NdvSettingsTab
        node={node}
        definition={definition}
        onNodeChange={vi.fn()}
      />,
    );
    expect(screen.getByText("HTTP Request node version 3")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/ndv-settings-tab.dom.test.tsx
```

Expected: FAIL — cannot resolve `./ndv-settings-tab`.

- [ ] **Step 3: Implement `NdvSettingsTab`**

Create `src/features/editor/components/node-detail-view/ndv-settings-tab.tsx`. `EDITOR_RUN_DEFAULTS` moves here from `node-config-panel.tsx` along with its comment:

```tsx
"use client";

import { useId } from "react";
import { baseFieldClass } from "@/features/editor/components/node-config-form";
import type { EditorNode } from "@/features/editor/store/atoms";
import { RUN_POLICY_KEY, resolveRunPolicy } from "@/nodes/shared/run-policy";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Settings tab of the node detail view (AF-UX-15).
 *
 * Absorbs the AF-M9-06 run-policy fields, which the old side panel hid behind
 * a collapsed <details> so they could not push a node's real configuration
 * below the fold in a 360px column. The tab has the room, so they are open.
 * The semantics are unchanged: placeholders show the value the node would
 * INHERIT (so an explicit 3 stays distinguishable from a default 3), clearing
 * a field deletes the override, and emptying the last one deletes the policy
 * key rather than leaving `{}` behind.
 */

/**
 * Mirror of the runner's `ENGINE_RUN_DEFAULTS` (AF-M9-06). Duplicated rather
 * than imported because the runner's copy reads `ENGINE_RETRIES` from
 * `process.env` in a server-only module; these values only ever fill in a
 * placeholder, so drifting would mislead the user, not break a run.
 */
const EDITOR_RUN_DEFAULTS = {
  maxAttempts: 3,
  backoffMs: 1000,
  timeoutMs: 60_000,
};

export function NdvSettingsTab({
  node,
  definition,
  onNodeChange,
}: {
  node: EditorNode;
  definition: NodeDefinition;
  onNodeChange: (patch: Partial<EditorNode>) => void;
}) {
  const uid = useId();
  const data = node.data ?? {};
  const policy = (data[RUN_POLICY_KEY] ?? {}) as Record<string, unknown>;

  const inherited = resolveRunPolicy(
    // Resolve what this node WOULD get with no policy of its own, so the
    // placeholders describe the fallback rather than echoing the value.
    Object.fromEntries(
      Object.entries(data).filter(([k]) => k !== RUN_POLICY_KEY),
    ),
    definition,
    EDITOR_RUN_DEFAULTS,
  );

  const setPolicyField = (
    key: string,
    value: number | boolean | undefined,
  ) => {
    const next = { ...policy };
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
    const nextData = { ...data };
    if (Object.keys(next).length === 0) {
      delete nextData[RUN_POLICY_KEY];
    } else {
      nextData[RUN_POLICY_KEY] = next;
    }
    onNodeChange({ data: nextData });
  };

  /** Empty input clears the override rather than writing 0. */
  const numberField = (
    key: "maxAttempts" | "backoffMs" | "timeoutMs",
    label: string,
    placeholder: number,
    hint: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${uid}-${key}`} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={`${uid}-${key}`}
        type="number"
        className={baseFieldClass()}
        placeholder={`Inherits ${placeholder}`}
        value={typeof policy[key] === "number" ? String(policy[key]) : ""}
        onChange={(e) => {
          const raw = e.target.value.trim();
          setPolicyField(key, raw === "" ? undefined : Number(raw));
        }}
      />
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${uid}-enabled`} className="text-sm font-medium">
          Enabled
        </label>
        <input
          id={`${uid}-enabled`}
          type="checkbox"
          className="size-4 rounded border-border"
          checked={!node.disabled}
          onChange={(e) => onNodeChange({ disabled: !e.target.checked })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-notes`} className="text-xs font-medium">
          Notes
        </label>
        <textarea
          id={`${uid}-notes`}
          rows={3}
          className={baseFieldClass()}
          placeholder="What does this node do?"
          value={node.notes ?? ""}
          onChange={(e) =>
            onNodeChange({
              notes: e.target.value.trim() ? e.target.value : undefined,
            })
          }
        />
      </div>

      <div className="border-t border-border pt-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          Run settings
        </p>
        <div className="flex flex-col gap-4">
          {numberField(
            "maxAttempts",
            "Max attempts",
            inherited.maxAttempts,
            "Total tries including the first. 1 disables retries.",
          )}
          {numberField(
            "backoffMs",
            "Retry backoff (ms)",
            inherited.backoffMs,
            "Doubles after each failed attempt.",
          )}
          {/* "Attempt timeout", not "Timeout": several nodes (HTTP Request,
              Webhook) declare their own `timeoutMs` for the outbound request,
              and two fields labelled "Timeout" on one panel would be a coin
              flip. This one is the engine's wall clock for one attempt of the
              whole node. */}
          {numberField(
            "timeoutMs",
            "Attempt timeout (ms)",
            inherited.timeoutMs,
            "Engine wall clock for one attempt of this node — separate from any request timeout the node itself configures.",
          )}

          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor={`${uid}-continueOnFail`}
              className="text-sm font-medium"
            >
              Continue on fail
            </label>
            <input
              id={`${uid}-continueOnFail`}
              type="checkbox"
              className="size-4 rounded border-border"
              checked={policy.continueOnFail === true}
              onChange={(e) =>
                setPolicyField(
                  "continueOnFail",
                  e.target.checked ? true : undefined,
                )
              }
            />
          </div>
          <p className="-mt-2 text-[10px] text-muted-foreground">
            The run keeps going when this node fails. The node is still
            recorded as failed.
          </p>
        </div>
      </div>

      <p className="border-t border-border pt-4 text-[10px] text-muted-foreground">
        {definition.label} node version {definition.version}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/ndv-settings-tab.dom.test.tsx
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/features/editor/components/node-detail-view/ndv-settings-tab.tsx src/features/editor/components/node-detail-view/ndv-settings-tab.dom.test.tsx
git commit -m "feat(editor): node detail view Settings tab (AF-UX-15)

Enabled, Notes and the four AF-M9-06 run-policy fields, un-collapsed. The
<details> wrapper existed because a 360px column had no room; the tab does.
Inherit-placeholder and delete-the-key-on-empty semantics are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `InputPane` and `OutputPane`

The two data columns. They are symmetric, share `DataViewer`, and are reviewed together.

**Files:**
- Create: `src/features/editor/components/node-detail-view/input-pane.tsx`
- Create: `src/features/editor/components/node-detail-view/output-pane.tsx`
- Test: `src/features/editor/components/node-detail-view/panes.dom.test.tsx`
- Modify: `src/features/editor/components/node-config-panel.tsx` (export `WebhookTester`)

**Interfaces:**
- Consumes: `DataViewer` (Task 4); `NodeRunView` (Task 5); `WebhookTester` from `node-config-panel.tsx`.
- Produces:
  - `InputPane({ run: NodeRunView, definition: NodeDefinition, workflowId: string, onExecute: () => void, isRunning: boolean })`
  - `OutputPane({ run: NodeRunView })`

- [ ] **Step 1: Export `WebhookTester` so it can move**

In `src/features/editor/components/node-config-panel.tsx`, change `function WebhookTester(` to `export function WebhookTester(`. Task 10 deletes that file and moves the component into `input-pane.tsx` wholesale; exporting it now keeps this task's diff small and reviewable.

- [ ] **Step 2: Write the failing tests**

Create `src/features/editor/components/node-detail-view/panes.dom.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { NodeRunView } from "@/features/editor/hooks/use-step-run";
import type { NodeDefinition } from "@/nodes/types";
import { TRPCTestProvider } from "@/trpc/test-provider";
import { InputPane } from "./input-pane";
import { OutputPane } from "./output-pane";

const withTrpc = (ui: React.ReactElement) =>
  render(<TRPCTestProvider>{ui}</TRPCTestProvider>);

const action: NodeDefinition = {
  type: "HTTP_REQUEST",
  category: "ACTION",
  label: "HTTP Request",
  description: "Call an HTTP endpoint.",
  version: 3,
  icon: "Globe",
  inputs: [],
  outputs: [],
  configSchema: z.object({}),
  defaults: {},
};

const trigger: NodeDefinition = {
  ...action,
  type: "SCHEDULE_TRIGGER",
  category: "TRIGGER",
  label: "Schedule Trigger",
};

const idle: NodeRunView = {
  status: "idle",
  input: undefined,
  output: undefined,
  error: null,
  skipReason: null,
  durationMs: null,
  tokensIn: null,
  tokensOut: null,
  costUsd: null,
  blockedBy: null,
};

describe("OutputPane (AF-UX-15)", () => {
  it("prompts to execute when idle", () => {
    render(<OutputPane run={idle} />);
    expect(screen.getByText(/execute this step to see output/i)).toBeTruthy();
  });

  it("says it is executing while running", () => {
    render(<OutputPane run={{ ...idle, status: "running" }} />);
    expect(screen.getByText(/executing/i)).toBeTruthy();
  });

  it("renders output and the run stats on success", () => {
    render(
      <OutputPane
        run={{
          ...idle,
          status: "success",
          output: [{ id: 1 }],
          durationMs: 240,
          tokensIn: 10,
          tokensOut: 20,
          costUsd: 0.0012,
        }}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText(/240 ms/)).toBeTruthy();
    expect(screen.getByText(/30 tokens/)).toBeTruthy();
  });

  it("omits the token line for a node that used none", () => {
    render(
      <OutputPane
        run={{ ...idle, status: "success", output: { ok: true }, durationMs: 5, tokensIn: 0, tokensOut: 0, costUsd: 0 }}
      />,
    );
    expect(screen.queryByText(/tokens/)).toBeNull();
  });

  it("shows the error on failure", () => {
    render(
      <OutputPane run={{ ...idle, status: "failed", error: "HTTP 500" }} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("HTTP 500");
  });

  it("names the upstream node that blocked this one", () => {
    render(
      <OutputPane
        run={{
          ...idle,
          status: "failed",
          error: "HTTP 500",
          blockedBy: "Fetch stats",
        }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Fetch stats");
  });

  it("shows the skip reason when the node was skipped", () => {
    render(
      <OutputPane
        run={{ ...idle, status: "skipped", skipReason: "Node is disabled" }}
      />,
    );
    expect(screen.getByText(/node is disabled/i)).toBeTruthy();
  });
});

describe("InputPane (AF-UX-15)", () => {
  it("prompts to execute when an action node has no run yet", () => {
    withTrpc(
      <InputPane
        run={idle}
        definition={action}
        workflowId="w1"
        onExecute={vi.fn()}
        isRunning={false}
      />,
    );
    expect(screen.getByText(/no input data yet/i)).toBeTruthy();
  });

  it("renders the resolved input after a run", () => {
    withTrpc(
      <InputPane
        run={{ ...idle, status: "success", input: [{ email: "a@b.c" }] }}
        definition={action}
        workflowId="w1"
        onExecute={vi.fn()}
        isRunning={false}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("a@b.c")).toBeTruthy();
  });

  it("names the upstream node that failed instead of claiming no run", () => {
    withTrpc(
      <InputPane
        run={{ ...idle, status: "failed", blockedBy: "Fetch stats" }}
        definition={action}
        workflowId="w1"
        onExecute={vi.fn()}
        isRunning={false}
      />,
    );
    expect(screen.getByText(/Fetch stats/)).toBeTruthy();
    expect(screen.queryByText(/no input data yet/i)).toBeNull();
  });

  it("offers a trigger affordance instead of an input for a trigger node", () => {
    withTrpc(
      <InputPane
        run={idle}
        definition={trigger}
        workflowId="w1"
        onExecute={vi.fn()}
        isRunning={false}
      />,
    );
    expect(screen.getByText(/pull in test data/i)).toBeTruthy();
    expect(screen.queryByText(/no input data yet/i)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/panes.dom.test.tsx
```

Expected: FAIL — cannot resolve `./input-pane`.

- [ ] **Step 4: Implement `OutputPane`**

Create `src/features/editor/components/node-detail-view/output-pane.tsx`:

```tsx
"use client";

import { Loader2Icon } from "lucide-react";
import { formatUsdCost } from "@/features/editor/lib/cost-estimate";
import type { NodeRunView } from "@/features/editor/hooks/use-step-run";
import { DataViewer } from "./data-viewer";

/**
 * Right column of the node detail view (AF-UX-15).
 *
 * Every number here comes off the persisted `NodeExecution` row, not a
 * client-side estimate — this is what the node actually did, which is the
 * point of running it from inside the view.
 */
export function OutputPane({ run }: { run: NodeRunView }) {
  return (
    <section
      aria-label="Output"
      className="flex h-full min-h-0 flex-col gap-2 p-3"
    >
      <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Output
      </h2>

      {run.status === "running" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
          <p>Executing…</p>
        </div>
      ) : run.status === "failed" ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium text-destructive">
            {run.blockedBy
              ? `The run failed at "${run.blockedBy}" before this node ran.`
              : "This step failed."}
          </p>
          {run.error ? (
            <p className="mt-1 font-mono text-xs break-words text-muted-foreground">
              {run.error}
            </p>
          ) : null}
        </div>
      ) : run.status === "skipped" ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">This step was skipped.</p>
          {run.skipReason ? <p className="mt-1">{run.skipReason}</p> : null}
        </div>
      ) : run.status === "success" ? (
        <>
          <RunStats run={run} />
          <DataViewer value={run.output} label="Output" />
        </>
      ) : (
        <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          Execute this step to see output.
        </p>
      )}
    </section>
  );
}

function RunStats({ run }: { run: NodeRunView }) {
  const tokens = (run.tokensIn ?? 0) + (run.tokensOut ?? 0);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {run.durationMs !== null ? <span>{run.durationMs} ms</span> : null}
      {/* A non-AI node records zero tokens and zero cost; printing
          "0 tokens · $0.00" on every HTTP call would be noise. */}
      {tokens > 0 ? <span>{tokens} tokens</span> : null}
      {run.costUsd !== null && run.costUsd > 0 ? (
        <span>{formatUsdCost(run.costUsd)}</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Implement `InputPane`**

Create `src/features/editor/components/node-detail-view/input-pane.tsx`:

```tsx
"use client";

import { WebhookTester } from "@/features/editor/components/node-config-panel";
import type { NodeRunView } from "@/features/editor/hooks/use-step-run";
import type { NodeDefinition } from "@/nodes/types";
import { DataViewer } from "./data-viewer";

/**
 * Left column of the node detail view (AF-UX-15).
 *
 * A trigger has no input by definition, so for one this pane holds the
 * trigger's own way of getting test data in — the webhook payload tester for
 * WEBHOOK_TRIGGER, and otherwise a prompt to execute the trigger and capture
 * what it emits.
 */
export function InputPane({
  run,
  definition,
  workflowId,
  onExecute,
  isRunning,
}: {
  run: NodeRunView;
  definition: NodeDefinition;
  workflowId: string;
  onExecute: () => void;
  isRunning: boolean;
}) {
  const isTrigger = definition.category === "TRIGGER";

  return (
    <section
      aria-label="Input"
      className="flex h-full min-h-0 flex-col gap-2 p-3"
    >
      <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Input
      </h2>

      {isTrigger ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">Pull in test data</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A trigger has no input of its own. Execute it to capture the data
              it emits, then configure the rest of the workflow against that.
            </p>
            <button
              type="button"
              onClick={onExecute}
              disabled={isRunning}
              className="mt-3 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {isRunning ? "Executing…" : "Execute step"}
            </button>
          </div>
          {definition.type === "WEBHOOK_TRIGGER" ? (
            <WebhookTester workflowId={workflowId} />
          ) : null}
        </div>
      ) : run.blockedBy ? (
        <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          The run failed at &ldquo;{run.blockedBy}&rdquo; before this node ran,
          so there is no input to show.
        </p>
      ) : run.input !== undefined && run.input !== null ? (
        <DataViewer value={run.input} label="Input" />
      ) : (
        <p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          No input data yet — execute this step to pull data through from the
          previous node.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/panes.dom.test.tsx
```

Expected: PASS — 11 tests.

- [ ] **Step 7: Verify types and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors, no diagnostics.

- [ ] **Step 8: Commit**

```bash
git add src/features/editor/components/node-detail-view/input-pane.tsx src/features/editor/components/node-detail-view/output-pane.tsx src/features/editor/components/node-detail-view/panes.dom.test.tsx src/features/editor/components/node-config-panel.tsx
git commit -m "feat(editor): node detail view Input and Output panes (AF-UX-15)

Output shows the real NodeExecution row - payload, duration, tokens, cost, or
the error. Input shows the resolved input, names the upstream node when the
run failed before reaching this one, and for a trigger holds the trigger's own
test-data affordance instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: `NodeDetailView` assembly

The modal shell, the Parameters tab, the Execute step button, and the responsive collapse.

**Files:**
- Create: `src/features/editor/components/node-detail-view/ndv-parameters-tab.tsx`
- Create: `src/features/editor/components/node-detail-view/node-detail-view.tsx`
- Test: `src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx`

**Interfaces:**
- Consumes: `NdvHeader` (Task 6), `NdvSettingsTab` (Task 7), `InputPane`/`OutputPane` (Task 8), `useStepRun` (Task 5), `NodeConfigForm` (Task 3).
- Produces:
  - `NdvParametersTab({ node: EditorNode, definition: NodeDefinition, onDataChange: (next: Record<string, unknown>) => void })`
  - `NodeDetailView({ workflowId: string, node: EditorNode, definition: NodeDefinition, onNodeChange: (patch: Partial<EditorNode>) => void, onClose: () => void })`

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorNode } from "@/features/editor/store/atoms";
import { definition as httpDefinition } from "@/nodes/http/request/definition";
import { TRPCTestProvider } from "@/trpc/test-provider";
import { NodeDetailView } from "./node-detail-view";

const node: EditorNode = {
  id: "n1",
  type: "HTTP_REQUEST",
  name: "Fetch stats",
  data: { method: "GET", endpoint: "https://api.example.com/users" },
  position: { x: 0, y: 0 },
};

const renderView = (over: Partial<Parameters<typeof NodeDetailView>[0]> = {}) =>
  render(
    <TRPCTestProvider>
      <NodeDetailView
        workflowId="w1"
        node={node}
        definition={httpDefinition}
        onNodeChange={vi.fn()}
        onClose={vi.fn()}
        {...over}
      />
    </TRPCTestProvider>,
  );

describe("NodeDetailView (AF-UX-15)", () => {
  it("renders all three regions", () => {
    renderView();
    expect(screen.getByLabelText("Input")).toBeTruthy();
    expect(screen.getByLabelText("Output")).toBeTruthy();
    expect(screen.getByLabelText("Node name")).toBeTruthy();
  });

  it("opens on the Parameters tab", () => {
    renderView();
    expect(
      screen.getByRole("tab", { name: "Parameters" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("switches to Settings", () => {
    renderView();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByLabelText("Max attempts")).toBeTruthy();
  });

  it("keeps Execute step reachable from both tabs", () => {
    renderView();
    expect(screen.getByRole("button", { name: "Execute step" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Execute step" })).toBeTruthy();
  });

  it("closes on the header close button", () => {
    const onClose = vi.fn();
    renderView({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("patches the node name from the header", () => {
    const onNodeChange = vi.fn();
    renderView({ onNodeChange });
    fireEvent.change(screen.getByLabelText("Node name"), {
      target: { value: "Fetch users" },
    });
    expect(onNodeChange).toHaveBeenCalledWith({ name: "Fetch users" });
  });

  it("renders the deprecation notice on the Parameters tab", () => {
    renderView({
      definition: {
        ...httpDefinition,
        deprecated: {
          since: "1.0",
          replacedBy: "HTTP_REQUEST_V2",
          reason: "Because testing.",
        },
      },
    });
    expect(screen.getByText(/deprecated since 1\.0/i)).toBeTruthy();
  });

  it("renders the account requirement on the Parameters tab", () => {
    renderView({
      definition: {
        ...httpDefinition,
        accountRequirement: "Needs a paid tier.",
      },
    });
    expect(screen.getByText("Needs a paid tier.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx
```

Expected: FAIL — cannot resolve `./node-detail-view`.

- [ ] **Step 3: Implement `NdvParametersTab`**

Create `src/features/editor/components/node-detail-view/ndv-parameters-tab.tsx`. The deprecation and account-requirement notices move here verbatim from `node-config-panel.tsx` (lines 675-707), comments included:

```tsx
"use client";

import { SparklesIcon } from "lucide-react";
import { useMemo } from "react";
import { NodeConfigForm } from "@/features/editor/components/node-config-form";
import {
  estimateNodeCost,
  formatUsdCost,
} from "@/features/editor/lib/cost-estimate";
import type { EditorNode } from "@/features/editor/store/atoms";
import { findManifestEntry } from "@/nodes/manifest";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Parameters tab of the node detail view (AF-UX-15): the node's own
 * configuration, plus the two notices that must be read *before* a run rather
 * than discovered from one.
 */
export function NdvParametersTab({
  node,
  definition,
  onDataChange,
}: {
  node: EditorNode;
  definition: NodeDefinition;
  onDataChange: (next: Record<string, unknown>) => void;
}) {
  const costEstimate = useMemo(() => estimateNodeCost(node), [node]);

  return (
    <div className="flex flex-col gap-4">
      {definition.deprecated ? (
        <output className="block rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">
            Deprecated since {definition.deprecated.since}
          </p>
          <p className="mt-1 text-muted-foreground">
            {definition.deprecated.reason}
          </p>
          <p className="mt-1 text-muted-foreground">
            This node still runs, but it can no longer be added to a workflow.
            Replace it with{" "}
            <span className="font-mono">
              {findManifestEntry(definition.deprecated.replacedBy)?.label ??
                definition.deprecated.replacedBy}
            </span>
            .
          </p>
        </output>
      ) : null}

      {definition.accountRequirement ? (
        // AF-M10-22: a requirement of the provider ACCOUNT, which no amount of
        // reconnecting fixes. X's v2 write endpoints are not on the free tier;
        // YouTube uploads need a quota increase. Both surface at run time as a
        // 403 that reads like a permissions bug, so they are said here — while
        // the node is being configured — instead.
        <output className="block rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs">
          <p className="font-medium text-foreground">Account requirement</p>
          <p className="mt-1 text-muted-foreground">
            {definition.accountRequirement}
          </p>
        </output>
      ) : null}

      <NodeConfigForm
        key={node.id}
        definition={definition}
        data={node.data}
        onDataChange={onDataChange}
      />

      {costEstimate ? (
        <div className="flex items-center justify-between rounded-lg border border-warning/25 bg-warning/8 px-3 py-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <SparklesIcon className="size-3.5 text-warning" />
            <span>Est. run cost:</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-semibold text-foreground">
              ~{formatUsdCost(costEstimate.costUsd)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              (~{costEstimate.inputTokens + costEstimate.outputTokens} tok)
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Implement `NodeDetailView`**

Create `src/features/editor/components/node-detail-view/node-detail-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStepRun } from "@/features/editor/hooks/use-step-run";
import type { EditorNode } from "@/features/editor/store/atoms";
import type { NodeDefinition } from "@/nodes/types";
import { InputPane } from "./input-pane";
import { NdvHeader } from "./ndv-header";
import { NdvParametersTab } from "./ndv-parameters-tab";
import { NdvSettingsTab } from "./ndv-settings-tab";
import { OutputPane } from "./output-pane";

/**
 * Node detail view (AF-UX-15) — Input | Parameters·Settings | Output.
 *
 * Replaces the 360px side panel. Execute step runs the workflow from the
 * trigger through this node (`mode: "upTo"`) and stays put, so the left and
 * right columns show what this node actually received and produced rather
 * than what the user imagined it would.
 */
export function NodeDetailView({
  workflowId,
  node,
  definition,
  onNodeChange,
  onClose,
}: {
  workflowId: string;
  node: EditorNode;
  definition: NodeDefinition;
  onNodeChange: (patch: Partial<EditorNode>) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"parameters" | "settings">("parameters");
  const run = useStepRun(workflowId, node.id);

  const centre = (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "parameters" | "settings")}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <TabsList>
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <button
          type="button"
          onClick={run.execute}
          disabled={run.isRunning}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {run.isRunning ? "Executing…" : "Execute step"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <TabsContent value="parameters">
          <NdvParametersTab
            node={node}
            definition={definition}
            onDataChange={(data) => onNodeChange({ data })}
          />
        </TabsContent>
        <TabsContent value="settings">
          <NdvSettingsTab
            node={node}
            definition={definition}
            onNodeChange={onNodeChange}
          />
        </TabsContent>
      </div>
    </Tabs>
  );

  const input = (
    <InputPane
      run={run}
      definition={definition}
      workflowId={workflowId}
      onExecute={run.execute}
      isRunning={run.isRunning}
    />
  );
  const output = <OutputPane run={run} />;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(860px,90vh)] w-[min(1400px,95vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        {/* Radix requires both for the dialog to be announced; the visible
            title is the editable name field, which cannot be the DialogTitle. */}
        <DialogTitle className="sr-only">
          {node.name ?? definition.label} configuration
        </DialogTitle>
        <DialogDescription className="sr-only">
          {definition.description}
        </DialogDescription>

        <NdvHeader
          node={node}
          definition={definition}
          onNameChange={(name) => onNodeChange({ name })}
          onClose={onClose}
        />

        {/* Exactly one of the two layouts is in the DOM at a time. A CSS-only
            `hidden lg:block` / `lg:hidden` pair would put both trees in the
            document, so every pane would exist twice — duplicated labels for
            assistive tech, two mounted DataViewers, and ambiguous queries in
            tests. The breakpoint is resolved in JS instead. */}
        {isWide ? (
          <ResizablePanelGroup
            direction="horizontal"
            className="min-h-0 flex-1"
          >
            <ResizablePanel defaultSize={30} minSize={15}>
              {input}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40} minSize={25}>
              {centre}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={15}>
              {output}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <Tabs
            defaultValue="config"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="mx-3 mt-2 shrink-0">
              <TabsTrigger value="input">Input</TabsTrigger>
              <TabsTrigger value="config">Parameters</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
            </TabsList>
            <TabsContent value="input" className="min-h-0 flex-1">
              {input}
            </TabsContent>
            <TabsContent value="config" className="min-h-0 flex-1">
              {centre}
            </TabsContent>
            <TabsContent value="output" className="min-h-0 flex-1">
              {output}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

And add this hook at the bottom of the same file. It mirrors `src/hooks/use-mobile.ts` exactly — same `useState(undefined)` → effect → `matchMedia` shape — at the `lg` breakpoint instead of `md`:

```tsx
const WIDE_BREAKPOINT = 1024;

/**
 * True at `lg` and above, where the three-column layout fits.
 *
 * Mirrors `src/hooks/use-mobile.ts` rather than importing it: that hook is
 * pinned to the 768px `md` breakpoint used by the sidebar, and this layout
 * needs 1024. Starts false and resolves in an effect, so SSR and the first
 * client paint agree; jsdom reports `innerWidth` 1024, so tests get the
 * three-column layout deterministically.
 */
function useIsWide(): boolean {
  const [isWide, setIsWide] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${WIDE_BREAKPOINT}px)`);
    const onChange = () => setIsWide(window.innerWidth >= WIDE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isWide;
}
```

Add `useEffect` to the `react` import at the top of the file, and read the hook inside `NodeDetailView` beside the other state:

```tsx
  const isWide = useIsWide();
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run --project dom src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx
```

Expected: PASS — 8 tests.

`useIsWide` resolves in an effect, so the first render is the narrow layout and the three-column one appears after React flushes effects. React Testing Library's `render` wraps in `act`, so effects have already run by the time the assertions execute and `getByLabelText("Input")` matches the single desktop tree. If a test ever races this, assert with `findBy*` rather than reintroducing a second tree.

- [ ] **Step 6: Verify types and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors, no diagnostics.

- [ ] **Step 7: Commit**

```bash
git add src/features/editor/components/node-detail-view/ndv-parameters-tab.tsx src/features/editor/components/node-detail-view/node-detail-view.tsx src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx
git commit -m "feat(editor): assemble the node detail view (AF-UX-15)

Dialog + three resizable columns, Parameters/Settings tabs, and an Execute
step button reachable from both. Collapses to three tabs below lg.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Wire into the editor and delete the side panel

**Files:**
- Modify: `src/features/editor/store/atoms.ts` (add `openNodeIdAtom`)
- Modify: `src/features/editor/components/editor.tsx`
- Modify: `src/features/editor/components/validation-panel.tsx:30-42` (error rows open the node)
- Move: `WebhookTester` from `node-config-panel.tsx` into `input-pane.tsx`
- Delete: `src/features/editor/components/node-config-panel.tsx`
- Delete: `src/features/editor/components/node-config-panel.dom.test.tsx`
- Test: `src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx` (append open/close tests)

**Interfaces:**
- Consumes: `NodeDetailView` (Task 9).
- Produces: `openNodeIdAtom: PrimitiveAtom<string | null>`.

- [ ] **Step 1: Add the atom**

In `src/features/editor/store/atoms.ts`, add beneath `selectedNodeIdAtom`:

```ts
/**
 * Id of the node whose detail view is open; null when none is (AF-UX-15).
 *
 * Deliberately separate from `selectedNodeIdAtom`: selection drives dragging,
 * deleting and the bottom-bar Test node button, and a full-screen modal on
 * every single click would make the canvas unusable. Double click (or Enter
 * on a selected node) opens; Esc and the header close button clear it.
 */
export const openNodeIdAtom = atom<string | null>(null);
```

- [ ] **Step 2: Move `WebhookTester` into `input-pane.tsx`**

Cut `WebhookTester` (with its `useSuspenseWorkflow`, `useState`, `toast`, `PlayIcon` imports) out of `node-config-panel.tsx` and paste it at the bottom of `input-pane.tsx`, unchanged. Remove the now-dead import of it from `input-pane.tsx` and keep the component private to that file.

- [ ] **Step 3: Wire the editor**

In `src/features/editor/components/editor.tsx`:

Replace the `NodeConfigPanel` import with:

```tsx
import { NodeDetailView } from "./node-detail-view/node-detail-view";
```

Add `openNodeIdAtom` to the existing atoms import, and read it beside the others:

```tsx
  const openNodeId = useAtomValue(openNodeIdAtom);
  const setOpenNodeId = useSetAtom(openNodeIdAtom);
```

Add `openNodeId !== null` to the history `disabled` condition:

```tsx
  // AF-UX-05: undo/redo history seeded from server data. Disabled while an
  // overlay owns the keyboard so shortcuts never mutate the graph under it —
  // including the AF-UX-15 detail view, whose modal hides the canvas an undo
  // would silently change.
  const { commit: historyCommit, ensureInitialized } = useGraphHistory({
    disabled: pendingDrop !== null || nodeSelectorOpen || openNodeId !== null,
  });
```

Add the double-click handler and the Enter shortcut, next to the other callbacks:

```tsx
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, clicked: Node) => {
      setOpenNodeId(clicked.id);
    },
    [setOpenNodeId],
  );

  // Enter opens the selected node, matching the double click. Suppressed while
  // focus is in a control, so it never fires from inside the view itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (openNodeId !== null || pendingDrop !== null || nodeSelectorOpen) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (selectedNodeId !== null) {
        event.preventDefault();
        setOpenNodeId(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nodeSelectorOpen, openNodeId, pendingDrop, selectedNodeId, setOpenNodeId]);
```

Pass the handler to `<ReactFlow>`, beside `onSelectionChange`:

```tsx
            onNodeDoubleClick={onNodeDoubleClick}
```

Resolve the open node and its definition from `openNodeId` rather than `selectedNodeId`. Replace `selectedNode` / `selectedDefinition` / `patchSelectedNode` with:

```tsx
  const openNode = useMemo(
    () => nodes.find((node) => node.id === openNodeId) ?? null,
    [nodes, openNodeId],
  );

  const openDefinition = useMemo(() => {
    if (!openNode || !openNode.type) return undefined;
    const manifestEntry = findManifestEntry(openNode.type);
    if (manifestEntry) return manifestEntry;
    // "INITIAL" is a persisted alias of the manual trigger until M1-02 migrates rows.
    return openNode.type === "INITIAL"
      ? findManifestEntry("MANUAL_TRIGGER")
      : undefined;
  }, [openNode]);

  const patchOpenNode = useCallback(
    (patch: Partial<EditorNode>) => {
      if (!openNodeId) return;
      let nextNodes: EditorNode[] | null = null;
      setNodes((prev) => {
        nextNodes = prev.map((node) =>
          node.id === openNodeId ? { ...node, ...patch } : node,
        );
        return nextNodes;
      });
      if (nextNodes !== null) {
        // Keystroke bursts coalesce into one undo step (AF-UX-05).
        historyCommit({ nodes: nextNodes, edges }, CONFIG_TYPING_FOLD_MS);
      }
      setSaveStatus("unsaved");
    },
    [edges, historyCommit, openNodeId, setNodes, setSaveStatus],
  );
```

Keep `selectedNodeId` and `onSelectionChange` exactly as they are — the bottom-bar buttons still read selection.

Replace the render block:

```tsx
        {openNode && openDefinition ? (
          <NodeDetailView
            workflowId={workflowId}
            node={openNode}
            definition={openDefinition}
            onNodeChange={patchOpenNode}
            onClose={() => setOpenNodeId(null)}
          />
        ) : null}
```

- [ ] **Step 4: Keep the validation panel's fix-this-error flow working**

`ValidationPanel`'s rows are documented as "click-to-focus the offending node", and today clicking one selects the node, which opened the config panel — so the click landed you on the field you had to fix. With opening moved to double click, that flow would stop at "selected and centred", which is a regression: the whole purpose of clicking a validation error is to go fix that node's configuration.

In `src/features/editor/components/validation-panel.tsx`, add `openNodeIdAtom` to the existing atoms import and open the node alongside selecting it:

```tsx
  const setSelectedNodeId = useSetAtom(selectedNodeIdAtom);
  const setOpenNodeId = useSetAtom(openNodeIdAtom);
  const { getNode, setCenter } = useReactFlow();

  const selectNode = useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      setSelectedNodeId(nodeId);
      // AF-UX-15: a validation error exists to be fixed, so land on the node's
      // configuration rather than merely selecting it. Opening moved to double
      // click on the canvas; this row is an explicit "take me to the problem".
      setOpenNodeId(nodeId);
      setCenter(node.position.x, node.position.y, {
        zoom: 1.2,
        duration: 500,
      });
    },
    [getNode, setSelectedNodeId, setOpenNodeId, setCenter],
  );
```

- [ ] **Step 5: Delete the side panel**

```bash
git rm src/features/editor/components/node-config-panel.tsx src/features/editor/components/node-config-panel.dom.test.tsx
```

- [ ] **Step 6: Confirm nothing still imports it**

```bash
npx rg -n "node-config-panel" src/
```

Expected: no matches. If any remain, fix the import — do not re-add the file.

- [ ] **Step 7: Append the open/close tests**

Add to `src/features/editor/components/node-detail-view/node-detail-view.dom.test.tsx`:

```tsx
describe("NodeDetailView open/close (AF-UX-15)", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderView({ onClose });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run the whole suite, types, lint and build**

```bash
npm test
```

Expected: PASS.

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run lint
```

Expected: no diagnostics.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Verify in the running app**

Start the dev server through the Browser pane (never `npm run dev` in a shell), open a workflow, and confirm by hand:

1. Single click a node — no modal; the node is selected and draggable.
2. Double click it — the detail view opens with three columns.
3. Press Escape — it closes.
4. Select a node, press Enter — it opens.
5. With the view open, press Ctrl+Z outside a field — the canvas does not change.
6. Click Execute step on a mid-graph node — Output fills with real data, Input shows what came from upstream, and the URL never leaves the editor.
7. Break a node's config (clear a required field), open the validation panel, click the error row — the detail view opens on that node.

- [ ] **Step 10: Commit**

```bash
git add -A src/features/editor
git commit -m "feat(editor): replace the node config side panel with the detail view (AF-UX-15)

Double click (or Enter on a selected node) opens; single click still only
selects, so the canvas stays usable. openNodeIdAtom is separate from
selectedNodeIdAtom for exactly that reason. Graph undo/redo is inert while the
view is open - an undo that changes a canvas hidden behind a modal is worse
than no undo. WebhookTester moves into the Input pane, where a trigger's test
data belongs; node-config-panel.tsx is deleted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Documentation (fold into Task 10's commit)

- [ ] Add an `AF-UX-15` entry to `docs/planning/tasks.md` in the same style as the neighbouring AF-UX rows, marked done, with the acceptance criteria from the spec §11.
- [ ] Update `docs/ux-improvement-plan.md` §1 to record that the config panel is now the detail view.
- [ ] Grep for stale references: `npx rg -n "config panel" docs/ AGENTS.md` — correct any that now describe something that does not exist. AGENTS.md §1's reality-check table is the highest-value one to fix.

**Per AGENTS.md §4: if a doc and the code disagree, the code is the truth and the doc is a bug — fix the doc in the same PR.**

---

## Plan self-review

**Spec coverage.** Every numbered spec section maps to a task: §4.1 → Task 10; §4.2 → Task 10 step 3; §4.3 → Task 9; §5.1 → Task 6; §5.2 → Task 9; §5.3 → Task 7; §5.4 → Task 9; §5.5 → Task 8; §5.6 → Task 8; §5.7 → Task 4; §6 → Tasks 1 and 5; §7 → Task 2; §8 → Task 3 and the file paths throughout; §9 edge cases → covered by tests in Tasks 5, 8 and 9, except *"node deleted while its view is open"*, which Task 10's `openNode && openDefinition` guard handles by construction; §10 → the test steps in every task; §11 → verified by Task 10 step 8.

**Deviations from the spec, and why.**

1. **`WebhookTester` moves in two steps** — exported in Task 8, relocated in Task 10 — so Task 8 does not have to delete a file it otherwise never touches. End state identical to spec §8.
2. **`ValidationPanel` gains an `openNodeIdAtom` write (Task 10, step 4), which the spec does not mention.** Found during review: the panel's rows are click-to-focus, and today selecting a node opened the config panel, so clicking a validation error landed you on the field to fix. Moving opening to double click would silently degrade that to "selected and centred". A validation row is an explicit "take me to the problem", so it opens the view.
3. **The `lg` breakpoint is resolved in JS, not CSS** (Task 9). A `hidden lg:block` / `lg:hidden` pair puts both layouts in the document at once — every pane mounted twice, duplicated `aria-label`s, two live `DataViewer`s. `useIsWide` mirrors the existing `src/hooks/use-mobile.ts` shape at 1024 instead of 768.

**Rejected during review.** Task 3 originally re-exported `NodeConfigForm` from `node-config-panel.tsx` "so the existing test import keeps resolving". Checked: nothing outside the panel and its own test ever imported it (`editor.tsx` imports only `NodeConfigPanel`), and Task 3 repoints that test — the re-export would have been dead code deleted one task later.

**Type consistency.** `NodeRunView` is defined once in Task 5 and consumed by name in Tasks 8 and 9. `baseFieldClass` is exported in Task 3 and consumed in Tasks 6 and 7. `draftNodeSchema` is defined in Task 2 and consumed by the router in the same task. `EditorNode` and `NodeDefinition` come from existing modules throughout. `selectNodeRun` and `isTerminalExecutionStatus` keep the same names in their definition, their tests and the hook.
