# AutoFlow — UX Improvement Plan

**Status:** Active
**Created:** 2026-09-04
**Owner:** Engineering / Product
**Last updated:** 2026-09-04

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
