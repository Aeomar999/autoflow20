import type { SearchResult } from "./types";

/**
 * Navigation and action entries (AF-M7-07).
 *
 * These carry no tenant data — they are the same for every workspace — so they
 * live on the client and never cost a round trip. Anything that names or counts
 * a tenant's own records belongs in `search.query` instead, behind
 * `orgViewerProcedure`.
 *
 * Kept in step with `app-sidebar.tsx`; `static-commands.test.ts` asserts every
 * destination here is a route that exists.
 */

export const NAVIGATION_COMMANDS: SearchResult[] = [
  {
    kind: "navigation",
    id: "nav-workflows",
    title: "Workflows",
    subtitle: "Build, deploy, and run",
    href: "/workflows",
  },
  {
    kind: "navigation",
    id: "nav-templates",
    title: "Templates",
    subtitle: "Install a ready-made workflow",
    href: "/templates",
  },
  {
    kind: "navigation",
    id: "nav-credentials",
    title: "Credentials",
    subtitle: "Connected services and keys",
    href: "/credentials",
  },
  {
    kind: "navigation",
    id: "nav-executions",
    title: "Executions",
    subtitle: "Every run and its node trace",
    href: "/executions",
  },
  {
    kind: "navigation",
    id: "nav-knowledge",
    title: "Knowledge Base",
    subtitle: "Documents for retrieval",
    href: "/knowledge",
  },
  {
    kind: "navigation",
    id: "nav-monitoring",
    title: "Monitoring",
    subtitle: "Success rate, duration, errors",
    href: "/monitoring",
  },
  {
    kind: "navigation",
    id: "nav-costs",
    title: "Costs",
    subtitle: "Spend per run, workflow, and model",
    href: "/costs",
  },
];

/** Ids the palette switches on for actions that run a mutation, not a route. */
export const ACTION_CREATE_WORKFLOW = "action-create-workflow";

export const ACTION_COMMANDS: SearchResult[] = [
  {
    kind: "action",
    id: ACTION_CREATE_WORKFLOW,
    title: "Create a workflow",
    subtitle: "New empty canvas",
  },
  {
    kind: "action",
    id: "action-new-credential",
    title: "Add a credential",
    subtitle: "Connect a service",
    href: "/credentials/new",
  },
  {
    kind: "action",
    id: "action-browse-templates",
    title: "Browse templates",
    subtitle: "Start from something that runs",
    href: "/templates",
  },
];
