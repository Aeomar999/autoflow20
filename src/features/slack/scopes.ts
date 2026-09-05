/**
 * Slack OAuth scopes, per operation (AF-M10-17).
 *
 * **Client-safe by construction** — node `definition.ts` files import these to
 * declare what they need, and definitions are bundled into the editor. No
 * value import from a server-only package may appear here
 * (`src/nodes/client-boundary.test.ts` enforces it).
 *
 * These exist because Slack's own failure mode for a missing scope is the
 * string `missing_scope` inside an HTTP 200 body. Declaring the requirement on
 * the node lets the config panel say "this needs channels:manage" *before* the
 * run, and lets the executor turn Slack's code into a sentence naming the
 * scope and the node that wanted it.
 */

export const SLACK_SCOPES = {
  /** Post into a channel the bot is a member of. */
  chatWrite: "chat:write",
  /** Post into a public channel the bot has NOT joined. */
  chatWritePublic: "chat:write.public",
  /** List and read public channels. */
  channelsRead: "channels:read",
  /** Create and manage public channels, and invite people to them. */
  channelsManage: "channels:manage",
  /** List and read private channels the bot is in. */
  groupsRead: "groups:read",
  /** Resolve a user id to a profile. */
  usersRead: "users:read",
  /** Look a user up by email address — a separate, more sensitive grant. */
  usersReadEmail: "users:read.email",
  /** Open a DM conversation with a user. */
  imWrite: "im:write",
} as const;

export type SlackScope = (typeof SLACK_SCOPES)[keyof typeof SLACK_SCOPES];

export const SLACK_CREDENTIAL_TYPE = "slack.oauth2";

export const SLACK_LOGO = "/logos/slack.svg";
