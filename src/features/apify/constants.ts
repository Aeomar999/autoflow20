/**
 * Apify vocabulary shared by node definitions (AF-M10-19).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const APIFY_CREDENTIAL_TYPE = "apify.apiKey";

export const APIFY_LOGO = "/logos/apify.svg";

/**
 * How long a run may be waited on, in seconds.
 *
 * Apify bills by compute unit for as long as an actor runs, so this is a
 * spending control as much as a timeout. The node aborts the run when it
 * expires — see `abortApifyRun`.
 */
export const APIFY_MAX_WAIT_SECONDS = 3600;
export const APIFY_DEFAULT_WAIT_SECONDS = 300;

/** Seconds between run-status polls. */
export const APIFY_POLL_SECONDS = 10;

/**
 * Rows one `APIFY_GET_DATASET` node will return.
 *
 * A scrape of a large site produces tens of thousands of items, and pulling
 * them all into the run context is how an execution record becomes unreadable
 * and a workflow runs out of memory.
 */
export const APIFY_MAX_ITEMS = 10_000;
export const APIFY_DEFAULT_ITEMS = 1_000;
