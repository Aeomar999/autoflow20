/**
 * Google Custom Search and Places vocabulary (AF-M10-19).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const GOOGLE_SEARCH_CREDENTIAL_TYPE = "googleCustomSearch.apiKey";
export const GOOGLE_SEARCH_LOGO = "/logos/google.svg";

/**
 * Google will not page past 100 results for a Custom Search query, whatever
 * `start` says, and returns ten per request. Ten requests is therefore the
 * whole result set — and ten billed queries.
 */
export const GOOGLE_SEARCH_MAX_RESULTS = 100;
export const GOOGLE_SEARCH_PAGE_SIZE = 10;

export const GOOGLE_MAPS_CREDENTIAL_TYPE = "googleMaps.apiKey";
export const GOOGLE_MAPS_LOGO = "/logos/google-maps.svg";

/**
 * Places text search returns 20 per page and at most 60 across three pages,
 * with a mandatory pause between them. Each page is a separately billed
 * request.
 */
export const GOOGLE_MAPS_MAX_RESULTS = 60;
export const GOOGLE_MAPS_PAGE_SIZE = 20;
