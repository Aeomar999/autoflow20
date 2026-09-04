/**
 * Jira vocabulary shared by node definitions (AF-M10-18).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const JIRA_CREDENTIAL_TYPE = "atlassian.oauth2";

export const JIRA_LOGO = "/logos/jira.png";

export const JIRA_SCOPES = {
  /** Read issues, projects, transitions and JQL results. */
  readWork: "read:jira-work",
  /** Create and update issues, add attachments, apply transitions. */
  writeWork: "write:jira-work",
  /** Resolve account ids for assignees and reporters. */
  readUser: "read:jira-user",
} as const;
