/**
 * Notion vocabulary shared by node definitions (AF-M10-18).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const NOTION_CREDENTIAL_TYPE = "notion.oauth2";

export const NOTION_LOGO = "/logos/notion.png";

/**
 * Notion has no OAuth scope strings.
 *
 * Access is granted per page or database when the user picks them in the
 * connect dialog, so "has a Notion credential" says nothing about whether a
 * given database is reachable. That is why the nodes' errors talk about
 * sharing a page with the integration rather than about scopes.
 */
export const NOTION_SCOPES: readonly string[] = [];
