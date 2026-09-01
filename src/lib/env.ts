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

  POLAR_ACCESS_TOKEN: z.string().optional(),
  POLAR_SUCCESS_URL: z.url("must be a valid absolute URL").optional(),
  POLAR_PRODUCT_ID: z.uuid("must be a UUID").optional(),
  POLAR_PRODUCT_SLUG: z.string().min(1).optional(),

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
});

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
 * Resend configuration for transactional auth email (AF-M8-04). Both are
 * optional at boot; the sending module in `src/lib/email.ts` throws a clear
 * error (never logs the key) when an auth flow needs them and they are absent.
 */
export const resendApiKey = process.env.RESEND_API_KEY;
export const resendFromEmail =
  process.env.RESEND_FROM_EMAIL ?? "AutoFlow <onboarding@resend.dev>";
