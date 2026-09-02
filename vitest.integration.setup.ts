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

// The credential vault refuses to seal anything without a master key, so the
// credentials suites cannot run without one. Defaulted here rather than in the
// CI job's env so a bare `npm run test:integration` works the same everywhere.
//
// Derived rather than written as a base64 literal: a 44-character base64 blob
// in a committed file is what a secret looks like to a scanner, and one that
// cries wolf on every run stops being read. Thirty-two bytes of a repeated
// filler character is self-evidently not a real key.
if (!process.env.CREDENTIAL_MASTER_KEY) {
  process.env.CREDENTIAL_MASTER_KEY = Buffer.alloc(
    32,
    "integration-test",
  ).toString("base64");
}

if (!process.env.TEST_DATABASE_URL) {
  console.warn(
    "[integration] TEST_DATABASE_URL is not set - integration suites will skip.",
  );
  // Skipping is opt-in per suite (`describe.runIf(hasDb)`), so it only holds
  // while every author remembers the guard - and one suite did not, which
  // meant it ran against whatever `.env` pointed `DATABASE_URL` at. On a
  // developer's checkout that is the dev database, and the suite creates and
  // deletes users and organizations.
  //
  // Repointing at an unresolvable host makes that structurally impossible: a
  // guarded suite still skips, and an unguarded one fails immediately with an
  // error that names the cause instead of quietly mutating real data.
  process.env.DATABASE_URL =
    "postgresql://unset@test-database-url-is-not-set.invalid:5432/unset";
} else {
  // Hard-require the integration project onto the TEST database. This must
  // happen in setup (before any module imports construct the Prisma client),
  // otherwise @/lib/db binds to .env's dev/prod DATABASE_URL — a truncated
  // production database is the failure mode we refuse to make possible.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
