# AutoFlow — UX Improvement Plan

**Status:** Active
**Created:** 2026-09-04
**Owner:** Engineering / Product
**Last updated:** 2026-09-06

> This document synthesizes findings from deep UX exploration across the AutoFlow platform.
> Priorities are based on user impact, frequency of interaction, and implementation effort.

---

## Executive Summary

AutoFlow has a solid foundation with clean route hierarchy, disciplined dirty tracking, and good architectural patterns. However, several UX gaps reduce productivity and create friction in core workflows. This plan addresses:

1. **Canvas editor** — destructive behaviors, missing feedback, palette UX
2. **Execution monitoring** — search/filter gaps, trace visualization
3. **File handling** — upload progress, error states, preview
4. **Cross-cutting** — loading states, empty states, keyboard shortcuts

---

## Priority Matrix

| Priority | Impact | Effort | Area |
|----------|--------|--------|------|
| 🔴 P0 | High | Low | Canvas destructive behaviors, save feedback |
| 🟠 P1 | High | Medium | Execution search/filter, node trace |
| 🟡 P2 | Medium | Medium | File upload UX, progress indicators |
| 🟢 P3 | Medium | High | Keyboard shortcuts, skeleton loaders |

---

## 1. Canvas Editor UX

### 1.1 Destructive INITIAL Trigger Replacement

**Current behavior:** When user adds a workflow with no trigger, the `INITIAL` trigger is silently replaced without confirmation.

**Problem:** User may have intentionally left the trigger blank, or may not realize the replacement happened.

**Solution:**
- Add confirmation dialog before replacing `INITIAL` trigger
- Show what will be replaced and why
- Add "Don't show again" option for power users

**Files to modify:**
- `src/features/editor/components/editor.tsx` — trigger replacement logic
- `src/features/editor/components/node-config-panel.tsx` — confirmation dialog

**Acceptance criteria:**
- [ ] Confirmation dialog appears before `INITIAL` replacement
- [ ] Dialog shows trigger type and explains why replacement is needed
- [ ] User can cancel replacement
- [ ] "Don't show again" preference persisted in localStorage

---

### 1.2 Non-Standard Pan Behavior

**Current behavior:** `panOnDrag={false}` in ReactFlow config.

**Problem:** Users expect to pan canvas by dragging on empty space (standard in Figma, Miro, etc.).

**Solution:**
- Change `panOnDrag` to `true` or `[1, 2]` (middle-click or right-click)
- Ensure node dragging still works (ReactFlow handles this automatically)
- Add visual cursor feedback for pan mode

**Files to modify:**
- `src/features/editor/components/editor.tsx` — ReactFlow props

**Acceptance criteria:**
- [ ] Canvas pans on drag in empty space
- [ ] Node dragging still works correctly
- [ ] Cursor changes to grab/grabbing during pan

---

### 1.3 Node Palette UX Enhancement

**Current behavior:** Flat list of nodes in a sheet dialog.

**Problem:** Hard to find specific nodes, no categorization, no search.

**Solution:**
- Group nodes by category (Triggers, Actions, Logic, AI, Integrations)
- Add search/filter input at top of palette
- Show recent/frequently used nodes at top
- Add keyboard navigation (arrow keys + Enter)

**Files to modify:**
- `src/components/node-selector.tsx` — palette component
- `src/features/editor/components/editor.tsx` — palette trigger

**Acceptance criteria:**
- [ ] Nodes grouped by category with collapsible sections
- [ ] Search input filters nodes by name/description
- [ ] Recent nodes shown at top of list
- [ ] Keyboard navigation works (up/down arrows, Enter to select)

---

### 1.4 Save State Feedback

**Current behavior:** Dirty state tracked, but no visual feedback during/after save.

**Problem:** User doesn't know if save is in progress, succeeded, or failed.

**Solution:**
- Add save status indicator (Saving... / Saved / Error)
- Show last saved timestamp
- Add toast notification on save success/failure
- Disable save button while saving to prevent double-clicks

**Files to modify:**
- `src/features/editor/components/editor-header.tsx` — save button
- `src/features/editor/components/editor.tsx` — dirty state logic

**Acceptance criteria:**
- [ ] Save button shows "Saving..." during save
- [ ] Success toast appears after save completes
- [ ] Error toast appears if save fails
- [ ] "Last saved: X seconds ago" shown in header
- [ ] Save button disabled while save in progress

---

## 2. Execution Monitoring UX

### 2.1 Add Search to Executions Page

**Current behavior:** Only status filter (Running, Success, Failed).

**Problem:** Users with many workflows can't find specific executions.

**Solution:**
- Add search input for workflow name or execution ID
- Debounce search (300ms)
- Show search results with highlighted matches
- Clear search button

**Files to modify:**
- `src/features/executions/components/executions.tsx` — list component

**Acceptance criteria:**
- [ ] Search input at top of executions list
- [ ] Filters by workflow name or execution ID
- [ ] Results update as user types (debounced)
- [ ] Clear button resets search
- [ ] Empty state shown when no results match

---

### 2.2 Add Workflow Name Filter

**Current behavior:** Can filter by status only.

**Problem:** Users want to see executions for a specific workflow.

**Solution:**
- Add dropdown to select workflow (from user's workflows)
- Multi-select option for comparing workflows
- Combine with existing status filter (AND logic)

**Files to modify:**
- `src/features/executions/components/executions.tsx` — filter controls

**Acceptance criteria:**
- [ ] Workflow dropdown shows all user's workflows
- [ ] Can select one or multiple workflows
- [ ] Filter combines with status filter (AND)
- [ ] Clear filters button resets all

---

### 2.3 Enhanced Node-Level Trace Visualization

**Current behavior:** Execution detail shows node status, but limited trace info.

**Problem:** Hard to debug workflow failures without detailed per-node trace.

**Solution:**
- Show node execution timeline (start/end time, duration)
- Display node inputs/outputs (sanitized for credentials)
- Show error messages with stack traces
- Add "Replay from here" button for failed nodes

**Files to modify:**
- `src/features/executions/components/execution.tsx` — detail view

**Acceptance criteria:**
- [ ] Timeline shows per-node start/end/duration
- [ ] Input/output data displayed (credentials masked)
- [ ] Error messages shown with context
- [ ] "Replay from here" button on failed nodes

---

### 2.4 Cost/Tokens Breakdown Per Execution

**Current behavior:** Execution shows total cost, but no per-node breakdown.

**Problem:** Users can't identify which nodes are most expensive.

**Solution:**
- Show cost/tokens per node in execution detail
- Highlight expensive nodes (>10% of total)
- Add cost comparison between executions
- Show cost trend over time

**Files to modify:**
- `src/features/executions/components/execution.tsx` — detail view
- `src/features/costs/components/cost-breakdown-tables.tsx` — breakdown display

**Acceptance criteria:**
- [ ] Per-node cost/tokens shown in execution detail
- [ ] Expensive nodes highlighted (>10% of total)
- [ ] Cost comparison available between executions
- [ ] Cost trend chart shows historical data

---

### 2.5 Live Run Progress (node-to-node + to 100%)

**Current behavior:** While an execution is running, the detail page shows only
high-level stats (status, started/completed, duration) and, once traces exist,
the "Node traces" panel. There is no sense of *where* in the graph the run is or
*how much* of the workflow has completed.

**Problem:** A run of a long or fan-out-heavy workflow looks frozen until it
finishes; users cannot tell whether it is making progress, which node is active,
or whether it is stuck.

**Solution:**
- Add a "Run progress" panel between the stats grid and the error callout.
- Overall progress: `done / total` nodes to 100%, rendered as a Progress bar
  with "N of M nodes · NN%" labeling. `total` is the deterministic topological
  node order of the execution's `graphSnapshot` (registryless `validate()`
  `order`); `done` counts distinct nodeIds that reached a terminal state
  (`SUCCESS` / `FAILED` / `SKIPPED`). Segment interior nodes write one
  NodeExecution row per item, so counting is by distinct nodeId, not rows.
- Node list: one row per node in topological order — position badge, name/type,
  status pill, connecting line. Active nodes get a running animation; skipped
  nodes are dimmed; nodes with no trace yet are "Pending" while the run is
  active and "Not run" once the run is terminal (cancelled / timed-out runs can
  leave `RUNNING`-state work unresolved — those are shown as not run, so the
  percent freezes below 100 instead of lying).
- No new transport or tRPC procedure: reuse the existing 3s polling in
  `useSuspenseExecution`. `executions.getOne` computes a `flow` field server-side
  from the already-returned `graphSnapshot` and `nodeExecutions`.
- Slides in naturally with §2.3 (per-node trace detail) — this is the
  at-a-glance view; §2.3 is the drill-down.

**Files to modify:**
- `src/inngest/functions.ts` — persist `graphSnapshot` on pre-created
  executions in `prepare-workflow` (currently only legacy/webhook-created runs
  and test runs store it, so live manual runs would have nothing to track).
- `src/features/executions/lib/flow.ts` (new) — pure `computeExecutionFlow`.
- `src/features/executions/lib/flow.test.ts` (new) — mandatory unit tests.
- `src/features/executions/server/routers.ts` — add `flow` to `getOne`.
- `src/features/executions/components/execution-flow.tsx` (new) — the panel.
- `src/features/executions/components/execution.tsx` — mount the panel.

**Acceptance criteria:**
- [ ] Live progress bar shows done/total node count and percent to 100% while a
      run is in flight, driven by existing 3s polling
- [ ] Node list shows each graph node in topological order with status
      (running/active, done, skipped, pending/not-run)
- [ ] Segment fan-out counts a node once regardless of how many items it ran
- [ ] Percent reaches 100 only when every node reached a terminal state; a
      cancelled or timed-out run freezes below 100 with remaining nodes "Not run"
- [ ] Production manual runs and retry-from-node runs carry a `graphSnapshot`
      (`functions.ts` persist) so the panel works there too
- [ ] Credentials never appear in the progress payload; only node id/name/type
      and aggregate counts leave the server

---

### 2.6 Live-Run Choreography — from One Node Process to Another

**Status:** Planned (2026-09-06) — epic `AF-UX-07 → AF-UX-14` in `docs/planning/tasks.md`.

**Current behavior:** Test runs on the canvas paint per-node `loading / success / error`
directly into node borders (`NodeStatusProvider` over 16 per-node-type realtime channel
subscriptions). The execution detail page shows the §2.5 progress list on a 3s poll. The run
itself never visibly *moves*: downstream nodes stay blank until their first event, the
connecting edges never animate, retries/attempts and fan-out item counts are invisible to the
eye, a node parked on an approval looks identical to a working one, and two concurrent runs of
the same workflow clobber each other's lights (events carry only `nodeId`).

**Problem:** The seam between nodes — the actual handoff — is the least legible moment of a
run. Users cannot see which node is queued next, which branch the routing actually took,
whether a pause means waiting, retrying, or stuck, or how much of a 57-item fan-out remains.
Fast runs finish before the 3s poll fires, so the detail page never shows them moving at all.

**Solution:**
- **Transport (AF-UX-07)** — one realtime channel per execution (`execution:<id>`) with a
  `node-status` topic: `{ executionId, nodeId, status: RUNNING|WAITING|SUCCESS|FAILED|
  SKIPPED, attempt, itemIndex?, itemTotal? }`. Executors publish through the run, not a static
  per-type channel (also fixing `switch` publishing through the manual-trigger channel).
  Realtime tokens are minted per run and ownership-checked.
- **Shared choreography layer (AF-UX-08)** — run-scoped status model with a monotonic guard;
  pure `queued / running / succeeded / failed / skipped / waiting` phase derivation;
  handoff-edge selection (the edges leaving the node that just went terminal are the ones that
  animate); a deterministic layered layout for the mini graph; and a reduced-motion gate. One
  `useLiveRun` subscription replaces the 16-subscription provider.
- **Canvas (AF-UX-09)** — nodes walk queued → running → terminal; the taken edge pulses while
  the downstream node queues; a pinned RunBar (run # · status · elapsed · live % · stop)
  frames the run; starting a new test resets the lights and stale-run events are ignored.
- **Detail page (AF-UX-10)** — a read-only mini live graph renders the run's `graphSnapshot`
  (persisted positions, else layered auto-layout) painted by the same choreography via one
  realtime subscription; the 3s poll remains only as final reconciliation (DB rows win).
  Per-node duration + attempt surface in the node tooltip (via the §2.5 `flow` extension);
  the §2.5 list stays below as the textual trace.
- **Retries (AF-UX-11)** — attempt badges and explicit "retrying (2/3)" transitions instead of
  flicker.
- **Fan-out (AF-UX-12)** — segment interior nodes show `N / M items` progress.
- **WAITING / SKIPPED (AF-UX-13)** — parked-on-approval reads as waiting, never hung; skipped
  is dimmed identically on every surface.
- **Landing (AF-UX-14)** — the RunBar summarizes the finished run, the canvas re-runs, a "last
  run" breadcrumb links to the detail mini graph, and a failed node affords "Replay from here"
  (§2.3).

**Principles:** (1) Realtime paints, the DB settles — a final state is never rendered from
realtime alone when the DB row denies it. (2) Edge movement is derived client-side from the
frontier; the payload carries no edge ids. (3) One choreography component set, shared by the
canvas and the mini graph, built once. (4) Reduced motion gates every animation; credentials,
node input/output, and error text never cross the realtime channel (ids, statuses, and
aggregate counts only).

**Files to modify (mapped per task in `docs/planning/tasks.md`):**
- `src/inngest/channels/*` — per-execution run channel
- `src/inngest/functions.ts` + `src/nodes/**/execute.ts` — `publishRunStatus()`; switch fix
- `src/features/executions/components/*/actions/*` — per-run token mint (ownership-gated)
- `src/features/executions/lib/live-run.ts` (+ `.test.ts`) — reducer / frontier / handoff /
  layout / motion gate
- `src/features/executions/components/live-run/*` — `useLiveRun`, `RunBar`, shared pills
- `src/components/react-flow/node-status-indicator.tsx` — `queued` variant; border pulse
- `src/features/editor/**` — canvas migration (editor.tsx, node-status-context.tsx,
  test-workflow-button.tsx)
- `src/features/executions/**` — detail migration (execution-flow-graph.tsx new; flow.ts +
  `getOne` timings; execution.tsx; §2.5 list retained)

**Acceptance criteria (epic):**
- [ ] A run visibly travels: each node walks queued → running → terminal, the connecting
      edge animating during every handoff
- [ ] Routing is legible (only the taken branch animates); retries, attempts, fan-out item
      counts, WAITING, and SKIPPED are all visually distinct
- [ ] Two concurrent runs never cross-paint; a previous run's late events never repaint
- [ ] The detail graph is live (realtime) with per-node duration/attempt and always settles
      to DB truth
- [ ] Reduced motion disables edge/pulse animation everywhere
- [ ] No credentials/input/output/error text in any realtime payload; per-run tokens are
      ownership-gated
- [ ] Ships as `AF-UX-07 → AF-UX-14`, one PR per task, mandatory tests per surface

## 3. File/Upload Handling UX

### 3.1 Enhanced Knowledge Upload with Progress

**Current behavior:** Upload dialog shows basic file selection, no progress.

**Problem:** User doesn't know if upload is in progress, how long it will take, or if it failed.

**Solution:**
- Add progress bar during upload
- Show file size and estimated time remaining
- Display upload speed
- Show success/failure status per file

**Files to modify:**
- `src/features/knowledge/components/upload-source-dialog.tsx` — upload component

**Acceptance criteria:**
- [ ] Progress bar shows upload percentage
- [ ] File size and ETA displayed
- [ ] Upload speed shown
- [ ] Success/failure status per file
- [ ] Retry button on failed uploads

---

### 3.2 File Preview for Uploaded Sources

**Current behavior:** Knowledge list shows file name and type only.

**Problem:** User can't preview content without downloading.

**Solution:**
- Add thumbnail preview for images/PDFs
- Show text preview for text files
- Add "Open in new tab" button for full preview
- Show file metadata (size, upload date, processing status)

**Files to modify:**
- `src/features/knowledge/components/knowledge-list.tsx` — list item
- `src/features/knowledge/components/source-detail-dialog.tsx` — detail view

**Acceptance criteria:**
- [ ] Thumbnail preview for images/PDFs
- [ ] Text preview for text files (first 500 chars)
- [ ] "Open in new tab" button for full preview
- [ ] File metadata shown (size, date, status)

---

### 3.3 Improved Error Messages for Failed Uploads

**Current behavior:** Generic error messages ("Upload failed").

**Problem:** User doesn't know why upload failed or how to fix it.

**Solution:**
- Show specific error reasons (file too large, invalid format, network error)
- Provide actionable guidance (reduce file size, check format)
- Add retry button with exponential backoff
- Show support contact for persistent failures

**Files to modify:**
- `src/features/knowledge/components/upload-source-dialog.tsx` — error handling

**Acceptance criteria:**
- [ ] Specific error reasons displayed
- [ ] Actionable guidance provided
- [ ] Retry button with backoff
- [ ] Support contact shown for persistent failures

---

### 3.4 Drag-and-Drop for Knowledge Sources

**Current behavior:** Click to select files only.

**Problem:** Drag-and-drop is more intuitive for file uploads.

**Solution:**
- Add drag-and-drop zone to upload dialog
- Show visual feedback when dragging over zone
- Support multiple file drops
- Validate files before upload

**Files to modify:**
- `src/features/knowledge/components/upload-source-dialog.tsx` — drag-and-drop zone

**Acceptance criteria:**
- [ ] Drag-and-drop zone with visual feedback
- [ ] Multiple file drops supported
- [ ] File validation before upload
- [ ] Error messages for invalid files

---

## 4. Cross-Cutting UX Improvements

### 4.1 Standardize Loading States

**Current behavior:** Inconsistent loading indicators (spinners, skeletons, none).

**Problem:** Users don't know if page is loading or broken.

**Solution:**
- Use skeleton loaders for all data-dependent components
- Show consistent spinner for actions (save, delete, etc.)
- Add loading states to all tRPC queries
- Ensure loading states match final layout (no layout shift)

**Files to modify:**
- All feature components with data loading

**Acceptance criteria:**
- [ ] Skeleton loaders for all list/detail views
- [ ] Spinners for all action buttons
- [ ] Loading states in tRPC query options
- [ ] No layout shift during loading

---

### 4.2 Enhanced Empty States

**Current behavior:** Generic "No items found" messages.

**Problem:** Users don't know what to do next or why list is empty.

**Solution:**
- Add illustrations to empty states
- Provide actionable guidance (create first workflow, upload first file)
- Show quick-start links
- Add "Learn more" links to documentation

**Files to modify:**
- All list components with empty states

**Acceptance criteria:**
- [ ] Illustrations for empty states
- [ ] Actionable guidance provided
- [ ] Quick-start links included
- [ ] "Learn more" links to docs

---

### 4.3 Keyboard Shortcuts

**Current behavior:** No keyboard shortcuts for common actions.

**Problem:** Power users lose productivity without shortcuts.

**Solution:**
- Add keyboard shortcuts for common actions:
  - `Ctrl/Cmd + S` — Save workflow
  - `Ctrl/Cmd + Z` — Undo
  - `Ctrl/Cmd + Shift + Z` — Redo
  - `Delete/Backspace` — Delete selected node
  - `Ctrl/Cmd + A` — Select all nodes
  - `Ctrl/Cmd + F` — Open command palette
- Add shortcut guide in settings
- Show shortcuts in tooltips

**Files to modify:**
- `src/features/editor/components/editor.tsx` — keyboard event handlers
- `src/features/search/components/command-palette.tsx` — shortcuts display

**Acceptance criteria:**
- [ ] All shortcuts work correctly
- [ ] Shortcut guide in settings
- [ ] Shortcuts shown in tooltips
- [ ] Shortcuts customizable in future

---

### 4.4 Consistent Toast Notifications

**Current behavior:** Inconsistent toast usage (some actions, not others).

**Problem:** Users miss important feedback (save success, delete confirmation).

**Solution:**
- Add toasts for all destructive actions (delete, remove)
- Add toasts for all async operations (save, upload, execute)
- Standardize toast positioning and duration
- Add undo option for destructive actions

**Files to modify:**
- All components with destructive actions
- All components with async operations

**Acceptance criteria:**
- [ ] Toasts for all destructive actions
- [ ] Toasts for all async operations
- [ ] Consistent positioning and duration
- [ ] Undo option for destructive actions

---

## 5. Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
- Fix `panOnDrag` behavior
- Add save state feedback
- Add search to executions page
- Standardize empty states

### Phase 2: Core Improvements (3-5 days)
- Destructive trigger confirmation dialog
- Node palette enhancement (categories + search)
- Enhanced knowledge upload with progress
- Add workflow name filter to executions

### Phase 3: Advanced Features (1-2 weeks)
- Node-level trace visualization
- Cost/tokens breakdown per execution
- File preview for knowledge sources
- Keyboard shortcuts

### Phase 4: Polish (Ongoing)
- Skeleton loaders for all components
- Toast notifications for all actions
- Drag-and-drop for file uploads
- Accessibility improvements

---

## 6. Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Time to first workflow | Unknown | < 5 minutes | Onboarding funnel |
| Execution search time | N/A (no search) | < 5 seconds | User testing |
| Upload success rate | Unknown | > 95% | Error logging |
| Save failure rate | Unknown | < 1% | Error logging |
| User satisfaction | Unknown | > 4.5/5 | NPS survey |

---

## 7. Open Questions

1. **Should we add undo for all destructive actions?** — Would require optimistic UI updates and undo stack
2. **How much trace detail to show?** — Full I/O may be large; consider summarization
3. **Keyboard shortcuts customizable?** — Start with defaults, make configurable later
4. **Mobile responsiveness priority?** — Editor is desktop-focused; when to optimize for tablet?

---

## 8. References

- `docs/architecture/overview.md` — Current architecture with gaps
- `docs/planning/tasks.md` — Master task backlog
- `docs/planning/progress.md` — Current progress snapshot
- `src/features/editor/components/editor.tsx` — Canvas editor implementation
- `src/features/executions/components/executions.tsx` — Execution list
- `src/features/knowledge/components/upload-source-dialog.tsx` — Knowledge upload
- `src/components/node-selector.tsx` — Node palette

---

**Next steps:**
1. Review this plan with team
2. Prioritize based on user feedback and roadmap
3. Create implementation tasks in `docs/planning/tasks.md`
4. Begin Phase 1 implementation
