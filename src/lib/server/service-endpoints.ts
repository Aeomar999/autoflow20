import "server-only";

/**
 * Where every third-party service lives, and the one seam that lets a test
 * point them at a local fixture server (AF-M10-34).
 *
 * Each client used to hold its own `const APIFY_API = "https://…"`. That is
 * fine until you try to prove a template runs: the fixture server can rewrite
 * `node.data.endpoint`, which only `HTTP_REQUEST` has, so roughly thirty of
 * the reference automations could not be driven offline at all. Collecting the
 * bases here gives every client the same seam without each one inventing its
 * own environment variable.
 *
 * The redirect is deliberately not a general-purpose "set any base URL"
 * feature. It is gated twice, and the second gate is the one that matters:
 *
 *  1. `NODE_ENV` must be `test`. Cheap, and wrong on its own — an env var can
 *     be set by whoever can set the other env var.
 *  2. The override must resolve to loopback. This is the real guarantee: even
 *     if the first gate were defeated, the worst a redirect can do is talk to
 *     the same machine. It cannot ship a tenant's Stripe key to a host an
 *     attacker controls, which is what a free-form base URL would allow.
 *
 * A malformed or non-loopback override throws rather than falling back to the
 * real endpoint. Falling back would turn "this test redirects Stripe" into
 * "this test quietly charged a real card", and a test suite that reaches the
 * public internet by accident is exactly what AF-M10-34 forbids.
 */

/**
 * Real production bases, including whatever path prefix the client appends to.
 *
 * The prefix is part of the value on purpose: a client builds
 * `${base}${path}`, so under a redirect the fixture receives exactly the path
 * suffix the client constructed — which is the part a contract test wants to
 * assert on.
 */
export const SERVICE_ENDPOINTS = {
  airtable: "https://api.airtable.com/v0",
  apify: "https://api.apify.com/v2",
  apollo: "https://api.apollo.io/api/v1",
  atlassian: "https://api.atlassian.com",
  bamboohr: "https://api.bamboohr.com/api/gateway.php",
  creatomate: "https://api.creatomate.com/v1",
  github: "https://api.github.com",
  greenhouse: "https://harvest.greenhouse.io/v1",
  gmail: "https://gmail.googleapis.com/gmail/v1/users/me",
  "google-calendar": "https://www.googleapis.com/calendar/v3/calendars",
  "google-custom-search": "https://www.googleapis.com/customsearch/v1",
  "google-drive": "https://www.googleapis.com/drive/v3/files",
  "google-drive-upload": "https://www.googleapis.com/upload/drive/v3/files",
  "google-places": "https://places.googleapis.com/v1/places:searchText",
  "google-sheets": "https://sheets.googleapis.com/v4/spreadsheets",
  lever: "https://api.lever.co/v1",
  linkedin: "https://api.linkedin.com/v2",
  mailerlite: "https://connect.mailerlite.com/api",
  notion: "https://api.notion.com/v1",
  openai: "https://api.openai.com/v1",
  pollinations: "https://image.pollinations.ai/prompt",
  "qbo-production": "https://quickbooks.api.intuit.com",
  "qbo-sandbox": "https://sandbox-quickbooks.api.intuit.com",
  slack: "https://slack.com/api",
  stripe: "https://api.stripe.com/v1",
  telegram: "https://api.telegram.org",
  "upload-post": "https://api.upload-post.com/api",
  vertex: "https://aiplatform.googleapis.com/v1",
  x: "https://api.x.com/2",
  "youtube-upload": "https://www.googleapis.com/upload/youtube/v3/videos",
} as const;

export type ServiceName = keyof typeof SERVICE_ENDPOINTS;

/**
 * Set by the integration suite's `globalSetup` to the fixture server's origin.
 *
 * An environment variable rather than a module-level setter because vitest
 * runs `globalSetup` in a different process from the test workers (`pool:
 * "forks"`), so there is no shared module instance to write into — the same
 * reason `FIXTURE_HTTP_PORT` is one.
 */
export const SERVICE_FIXTURE_ENV = "AUTOFLOW_SERVICE_FIXTURE_BASE";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The fixture origin, or null when no redirect is in force.
 *
 * Read per call rather than cached: the value is read after `globalSetup` has
 * run, but module import order across a fork pool is not something to bet
 * correctness on, and a URL parse is nothing next to the HTTP request that
 * follows it.
 */
function fixtureBase(): string | null {
  if (process.env.NODE_ENV !== "test") return null;

  const raw = process.env[SERVICE_FIXTURE_ENV];
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${SERVICE_FIXTURE_ENV} is not a valid URL: ${JSON.stringify(raw)}`,
    );
  }

  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${SERVICE_FIXTURE_ENV} must be an http:// loopback origin (127.0.0.1, localhost or ::1); got ${url.origin}`,
    );
  }

  return url.origin;
}

/** True when service calls are being redirected to a local fixture server. */
export function serviceFixtureActive(): boolean {
  return fixtureBase() !== null;
}

/**
 * The base URL for a service whose host is the same for every tenant.
 *
 * Call this per request rather than storing the result in a module constant:
 * a constant captures its value at import time, which for a fork-pool test
 * worker can be before the fixture server's origin is in the environment.
 */
export function serviceEndpoint(name: ServiceName): string {
  return redirectedServiceUrl(name, SERVICE_ENDPOINTS[name]);
}

/**
 * The base URL for a service whose host the caller computes — Shopify's
 * per-shop domain, or a user-supplied one.
 *
 * `name` is only the fixture's route segment here; the real base is whatever
 * the caller worked out. Under a redirect the tenant host is deliberately
 * dropped, because a fixture routes on the service and asserts on the path.
 */
export function redirectedServiceUrl(name: string, realBase: string): string {
  const base = fixtureBase();
  return base === null ? realBase : `${base}/${name}`;
}
