/**
 * Social publishing vocabulary shared by node definitions (AF-M10-22).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const X_CREDENTIAL_TYPE = "x.oauth2";
export const X_LOGO = "/logos/x.svg";

export const LINKEDIN_CREDENTIAL_TYPE = "linkedin.oauth2";
export const LINKEDIN_LOGO = "/logos/linkedin.svg";

export const YOUTUBE_CREDENTIAL_TYPE = "google.youtube";
export const YOUTUBE_LOGO = "/logos/youtube.svg";

export const UPLOAD_POST_CREDENTIAL_TYPE = "uploadPost.apiKey";
export const UPLOAD_POST_LOGO = "/logos/upload-post.svg";

/**
 * Platform limits, checked BEFORE the call so the error names the limit rather
 * than quoting the provider's rejection (AF-M10-22).
 *
 * Every one of these is a number the provider will not tell you until it says
 * no, usually in a message that gives the field but not the bound.
 */
export const X_MAX_POST_CHARS = 280;
export const X_MAX_IMAGES = 4;

/** LinkedIn's UGC commentary limit. Longer text is rejected outright. */
export const LINKEDIN_MAX_POST_CHARS = 3000;

/** YouTube's own field limits; the title also cannot contain `<` or `>`. */
export const YOUTUBE_MAX_TITLE_CHARS = 100;
export const YOUTUBE_MAX_DESCRIPTION_CHARS = 5000;
export const YOUTUBE_MAX_TAGS_CHARS = 500;

/**
 * Account requirements no credential can satisfy.
 *
 * Each of these is a property of the user's provider ACCOUNT — a paid tier, an
 * approved app, a quota grant — that reconnecting cannot fix, and that
 * otherwise appears at run time as a 403 indistinguishable from a scope
 * problem.
 */
export const X_ACCOUNT_REQUIREMENT =
  "Posting needs a paid X API tier. The free tier is read-only for v2 endpoints, so a free-tier key returns 403 on every post no matter which scopes were granted.";

export const LINKEDIN_ACCOUNT_REQUIREMENT =
  "Your LinkedIn app must be approved for the 'Share on LinkedIn' product, and the connected account must have the w_member_social permission. Approval is a request in the LinkedIn developer portal, not something the connect flow can grant.";

export const YOUTUBE_ACCOUNT_REQUIREMENT =
  "An unverified Google Cloud project uploads as PRIVATE regardless of the privacy setting, and is capped at a handful of uploads a day. Both are lifted by Google's API audit, not by reconnecting.";

export const UPLOAD_POST_ACCOUNT_REQUIREMENT =
  "Instagram publishing requires a Business or Creator account linked in Upload-Post. A personal account connects successfully and then fails at publish time.";
