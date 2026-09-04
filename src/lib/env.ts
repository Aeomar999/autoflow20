import { z } from "zod";

/**
 * Environment validation (AF-M0-08).
 *
 * Validated once at first import; the server calls `ensureEnv()` from
 * `instrumentation.ts` so a misconfigured deployment refuses to boot with a
 * single readable error naming every offending variable.
 *
 * Set SKIP_ENV_VALIDATION=1 to bypass (used by CI builds and test runners
 * where secrets are intentionally absent).
 */

/**
 * An RFC 5322 sender: either a bare address (`noreply@autoflow.dev`) or the
 * display-name form (`AutoFlow <noreply@autoflow.dev>`, quoted name allowed).
 *
 * AF-M8-15: this was `z.string().email()`, which rejected the display-name
 * form that `.env.example` and `resendFromEmail`'s own default both ship - so
 * a correctly-configured install failed `ensureEnv()` and refused to boot.
 * Exported for direct testing.
 */
export const emailSenderSchema = z.string().refine(
  (value) => {
    const match = /^\s*(?:"[^"]*"|[^<>"]*)\s*<([^<>]+)>\s*$/.exec(value);
    const address = match ? match[1].trim() : value.trim();
    return z.email().safeParse(address).success;
  },
  { message: "must be an email address or `Name <email@host>`" },
);

/**
 * An optional variable that `.env.example` ships as `""`.
 *
 * `z.uuid().optional()` accepts `undefined` but rejects the empty string, so
 * `cp .env.example .env` — the documented quick start — produced an install
 * that refused to boot with "POLAR_PRODUCT_ID: must be a UUID". Blank means
 * "not configured", the same as absent, so it is normalised to `undefined`
 * before the inner schema sees it.
 *
 * Same defect class as AF-M8-15, where `RESEND_FROM_EMAIL` rejected the exact
 * value `.env.example` shipped. A schema that a correctly-copied template
 * cannot satisfy is a bug in the schema.
 */
const blankAsUnset = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );

const serverEnvSchema = z.object({
  DATABASE_URL: z.url("must be a valid Postgres connection URL"),
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("must be a valid absolute URL"),
  ENCRYPTION_KEY: z
    .string()
    .min(32, "must be at least 32 characters")
    .optional()
    .describe(
      "Legacy Cryptr key; only required to run scripts/migrate-credentials.ts " +
        "on a database that still holds pre-AF-M3-02 ciphertexts. Not read at boot.",
    ),
  CREDENTIAL_MASTER_KEY: z
    .string()
    .min(1, "must be 32 bytes, base64-encoded (AF-M3-01)"),

  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // AF-M10-04: workflow OAuth connectors. All optional — a provider whose
  // pair is unset answers its connect route with 501 and nothing else in the
  // app is affected, so an install only configures the ones it uses. Note
  // GITHUB_OAUTH_* is a *different* app from GITHUB_* above: connecting a repo
  // integration must not widen what the sign-in button asks for.
  INTUIT_CLIENT_ID: z.string().optional(),
  INTUIT_CLIENT_SECRET: z.string().optional(),
  INTUIT_WEBHOOK_VERIFIER_TOKEN: z.string().optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),
  ATLASSIAN_CLIENT_ID: z.string().optional(),
  ATLASSIAN_CLIENT_SECRET: z.string().optional(),
  NOTION_CLIENT_ID: z.string().optional(),
  NOTION_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),

  // AF-M10-06: blob storage for binary payloads. All optional — an
  // unconfigured install writes to the local filesystem. `resolveBlobStore`
  // refuses to fall back in production when a bucket is set without
  // credentials, because that half-configured state is the one that
  // silently loses files.
  BLOB_S3_BUCKET: z.string().optional(),
  BLOB_S3_ACCESS_KEY_ID: z.string().optional(),
  BLOB_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BLOB_S3_REGION: z.string().optional(),
  BLOB_S3_ENDPOINT: z.string().optional(),
  BLOB_S3_FORCE_PATH_STYLE: z.string().optional(),
  BLOB_LOCAL_ROOT: z.string().optional(),

  POLAR_ACCESS_TOKEN: z.string().optional(),
  POLAR_PRODUCT_ID: blankAsUnset(z.uuid("must be a UUID")),
  POLAR_PRODUCT_SLUG: z.string().min(1).optional(),

  // AF-M8-23: the subscription webhooks that write `Organization.plan`.
  // Optional at boot for the same reason the rest of the Polar block is - an
  // install without billing configured still runs. When the secret is unset
  // the webhook handler is registered without one and Polar's deliveries fail
  // signature verification, so billing is inert rather than unauthenticated.
  POLAR_WEBHOOK_SECRET: blankAsUnset(z.string().min(1)),
  POLAR_PRODUCT_ID_STARTER: blankAsUnset(z.uuid("must be a UUID")),
  POLAR_PRODUCT_ID_PRO: blankAsUnset(z.uuid("must be a UUID")),
  POLAR_PRODUCT_ID_ENTERPRISE: blankAsUnset(z.uuid("must be a UUID")),

  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  SENTRY_AUTH_TOKEN: z.string().optional(),
  NGROK_URL: z.string().optional(),

  // AF-M8-04: transactional auth email (reset password + email verification)
  // via Resend. Optional so the app still boots and unaffected flows keep
  // working without them (same pattern as POLAR billing config). Auth flows
  // that REQUIRE sending an email fail loudly when these are missing - never
  // silently.
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: emailSenderSchema.optional(),

  // AF-M9-02: test-only loopback egress allowance for the engine's acceptance
  // suite. Optional at boot (defaults to off = fail closed); see
  // `allowLoopbackEgress()` for the production refusal.
  ALLOW_LOOPBACK_EGRESS: z.string().optional(),
});

/**
 * Exported for `env.test.ts`, which parses the real `.env.example` against it.
 * Not for application use - call `ensureEnv()` instead, which caches.
 */
export const serverEnvSchemaForTests = serverEnvSchema;

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export const ensureEnv = (): ServerEnv => {
  if (cached) {
    return cached;
  }

  if (process.env.SKIP_ENV_VALIDATION === "1") {
    cached = new Proxy(
      {},
      {
        get: (_t, prop: string) => process.env[prop],
      },
    ) as unknown as ServerEnv;
    return cached;
  }

  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `AutoFlow cannot start: invalid environment configuration.\n${problems}\nSee .env.example for the full list.`,
    );
  }

  cached = result.data;
  // AF-M9-02: refuse to boot a production deploy that sets the test-only
  // loopback egress flag before any request runs (fail fast, not permissive).
  allowLoopbackEgress();
  return cached;
};

/** Public base URL used by trigger dialogs when rendering webhook URLs. */
export const publicAppUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * Pro plan identifiers (AF-M0-03). `POLAR_PRODUCT_ID` is account-specific and
 * must come from env - when unset, the server-side checkout product list is
 * empty (billing unconfigured, matching optional POLAR_ACCESS_TOKEN).
 * The slug falls back to "pro" so local dev without billing config still
 * renders working checkout buttons; same single-point fallback pattern as
 * `publicAppUrl`. Server code may also set the non-public `POLAR_PRODUCT_SLUG`.
 */
export const polarProductId = process.env.POLAR_PRODUCT_ID;
export const polarProductSlug =
  process.env.POLAR_PRODUCT_SLUG ??
  process.env.NEXT_PUBLIC_POLAR_PRODUCT_SLUG ??
  "pro";

/**
 * Signing secret for the Polar subscription webhooks (AF-M8-23).
 *
 * Undefined when billing is not configured. The plugin rejects every delivery
 * with 400 in that case rather than trusting an unsigned body, so an install
 * without it has inert billing, not an open endpoint.
 */
export const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;

/**
 * Resend configuration for transactional auth email (AF-M8-04). Both are
 * optional at boot; the sending module in `src/lib/email.ts` throws a clear
 * error (never logs the key) when an auth flow needs them and they are absent.
 */
export const resendApiKey = process.env.RESEND_API_KEY;
export const resendFromEmail =
  process.env.RESEND_FROM_EMAIL ?? "AutoFlow <onboarding@resend.dev>";

/**
 * Test-only egress flag (AF-M9-02).
 *
 * `ALLOW_LOOPBACK_EGRESS=1` lets the workflow HTTP nodes reach `127.0.0.1` /
 * `::1` (and any hostname that resolves there, e.g. `localhost`), so the
 * engine's acceptance suite can run a loopback webhook/target server without
 * the SSRF guard rejecting every request. It is read raw (not via the schema)
 * so it works under `SKIP_ENV_VALIDATION` (the test runner), and it is
 * **refused in production**: the flag widens the egress surface, so a
 * misconfigured deploy must fail to boot rather than run permissive.
 *
 * The flag only widens loopback — the metadata ranges (`169.254/16`, +
 * `169.254.169.254`), private ranges (`10/8`, `172.16/12`, `192.168/16`),
 * CGNAT (`100.64/10`), and unique-local IPv6 all stay blocked regardless.
 */
export const allowLoopbackEgress = (): boolean => {
  const enabled = process.env.ALLOW_LOOPBACK_EGRESS === "1";
  if (enabled && process.env.NODE_ENV === "production") {
    throw new Error(
      "AutoFlow cannot start: ALLOW_LOOPBACK_EGRESS=1 is a test-only flag and is forbidden in production. Unset it before deploying.",
    );
  }
  return enabled;
};
