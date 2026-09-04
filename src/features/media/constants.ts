/**
 * Media generation vocabulary shared by node definitions (AF-M10-23).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const OPENAI_CREDENTIAL_TYPE = "openai.apiKey";
export const OPENAI_LOGO = "/logos/openai.svg";

export const POLLINATIONS_LOGO = "/logos/pollinations.svg";

export const VEO_CREDENTIAL_TYPE = "google.oauth2";
export const VEO_LOGO = "/logos/veo.svg";

export const CREATOMATE_CREDENTIAL_TYPE = "creatomate.apiKey";
export const CREATOMATE_LOGO = "/logos/creatomate.svg";

/**
 * How long a render may be waited on, in seconds.
 *
 * A cost control as much as a timeout: both providers meter, and a job nobody
 * is waiting on still finishes and still bills.
 */
export const MEDIA_MAX_WAIT_SECONDS = 3600;
export const MEDIA_DEFAULT_WAIT_SECONDS = 600;

/** Seconds between polls of a running job. */
export const MEDIA_POLL_SECONDS = 15;

/** Image sizes the OpenAI image models accept. */
export const OPENAI_IMAGE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
] as const;

export const OPENAI_IMAGE_MODELS = ["gpt-image-1", "dall-e-3"] as const;

/** Veo clip length, in seconds. Longer requests are refused by the API. */
export const VEO_MIN_SECONDS = 4;
export const VEO_MAX_SECONDS = 8;
