/**
 * GitHub vocabulary shared by node definitions (AF-M10-18).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const GITHUB_CREDENTIAL_TYPE = "github.oauth2";

export const GITHUB_LOGO = "/logos/github.svg";

export const GITHUB_SCOPES = {
  /** Read and write repository contents, pull requests and issues. */
  repo: "repo",
  /** Read organisation membership, needed to resolve org-owned repositories. */
  readOrg: "read:org",
} as const;

/** Events the trigger can subscribe to. */
export const GITHUB_TRIGGER_EVENTS = [
  "push",
  "pull_request",
  "issues",
  "issue_comment",
  "release",
] as const;

export type GithubTriggerEvent = (typeof GITHUB_TRIGGER_EVENTS)[number];
