import { config } from "dotenv";

/**
 * Setup for the `integration` vitest project (tests/integration/**).
 *
 * These tests hit a real Postgres. The database URL comes from
 * TEST_DATABASE_URL — see docs/engineering/testing_strategy.md §4 for the
 * local Docker recipe and CI wiring. When it is absent the suites
 * skip themselves visibly instead of failing or faking green.
 */
config();

// Note: not ??= here — .env may define these as EMPTY strings, which are
// nullish-safe but still unusable.
if (!process.env.BETTER_AUTH_URL) {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
}
if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = "integration-test-secret-not-used-for-auth0";
}
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}
// The webhook routes read this lazily per request; a fixed test secret is fine.
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_integration_test_signing_secret";
}

if (!process.env.TEST_DATABASE_URL) {
  console.warn(
    "[integration] TEST_DATABASE_URL is not set - integration suites will skip.",
  );
} else {
  // Hard-require the integration project onto the TEST database. This must
  // happen in setup (before any module imports construct the Prisma client),
  // otherwise @/lib/db binds to .env's dev/prod DATABASE_URL — a truncated
  // production database is the failure mode we refuse to make possible.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
