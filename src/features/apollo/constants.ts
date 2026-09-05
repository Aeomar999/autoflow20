/**
 * Apollo vocabulary shared by node definitions (AF-M10-19).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const APOLLO_CREDENTIAL_TYPE = "apollo.apiKey";

export const APOLLO_LOGO = "/logos/apollo.svg";

/**
 * Apollo bills **credits per enrichment**, not per request, and a match that
 * reveals an email costs more than one that does not. So the node asks for the
 * cheaper thing by default and `revealPersonalEmails` is opt-in.
 */
export const APOLLO_CREDIT_NOTE =
  "Each successful match spends an Apollo credit; revealing emails spends more.";
