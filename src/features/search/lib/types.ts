/**
 * Command palette result shapes (AF-M7-07).
 *
 * Client-safe: components import from here, never from `server/`.
 */

export type SearchResultKind =
  | "workflow"
  | "execution"
  | "credential"
  | "employee"
  | "navigation"
  | "action";

export interface SearchResult {
  kind: SearchResultKind;
  /** Unique within a result set; used as the cmdk item value. */
  id: string;
  /** The text ranking matches against. */
  title: string;
  subtitle?: string;
  /** Where selecting it navigates. Absent for results that run a mutation. */
  href?: string;
}

/** What `search.query` returns — tenant data only; nav and actions are static. */
export interface SearchResults {
  workflows: SearchResult[];
  executions: SearchResult[];
  credentials: SearchResult[];
  employees: SearchResult[];
}

export const SEARCH_GROUP_LABELS: Record<SearchResultKind, string> = {
  action: "Actions",
  navigation: "Go to",
  workflow: "Workflows",
  execution: "Executions",
  credential: "Credentials",
  employee: "People",
};

/** Render order of the groups in the palette. */
export const SEARCH_GROUP_ORDER: SearchResultKind[] = [
  "action",
  "navigation",
  "workflow",
  "execution",
  "credential",
  "employee",
];
