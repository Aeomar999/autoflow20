import { execSync } from "node:child_process";

/**
 * Global setup for the `integration` vitest project (tests/integration/**).
 *
 * Runs ONCE, in its own process, before any test file worker starts. It
 * applies migrations to the test database so that every suite — including
 * the ones that truncate tables but do not deploy migrations themselves —
 * sees the full schema. Without this, suites race on a fresh database: only
 * the webhook suite used to deploy migrations, and parallel workers crashed
 * on `relation ... does not exist` before that deploy finished.
 *
 * No-op when TEST_DATABASE_URL is absent (suites skip themselves in that
 * case anyway — see docs/engineering/testing_strategy.md §4).
 */
export default async function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    return;
  }
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    // dotenv does not override an explicitly passed DATABASE_URL, so this
    // can never touch the dev/prod database.
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
