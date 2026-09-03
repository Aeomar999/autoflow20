import { execSync } from "node:child_process";
import { config } from "dotenv";
import { startFixtureServer } from "./tests/integration/fixtures/http-fixture-server";

/**
 * Load `.env` here too (AF-M9-16).
 *
 * `globalSetup` runs in vitest's MAIN process; `vitest.integration.setup.ts`
 * runs per worker and is where `config()` was called. Nothing loaded `.env`
 * for this process, so `TEST_DATABASE_URL` read as `undefined` and the guard
 * below returned early — silently. This file has therefore never applied a
 * migration on a local run, despite its own comment saying it does, and the
 * race it was written to prevent was only being prevented in CI (where the
 * variable is a real job-level env var and a separate `prisma migrate deploy`
 * step runs anyway).
 *
 * Found while wiring the AF-M9-16 fixture server, whose port was likewise
 * never opened for the same reason.
 */
config();

/**
 * Global setup for the `integration` vitest project (tests/integration/**).
 *
 * Runs ONCE, in its own process, before any test file worker starts. It does
 * two things:
 *
 *  1. Applies migrations to the test database so that every suite — including
 *     the ones that truncate tables but do not deploy migrations themselves —
 *     sees the full schema. Without this, suites race on a fresh database:
 *     only the webhook suite used to deploy migrations, and parallel workers
 *     crashed on `relation ... does not exist` before that deploy finished.
 *
 *  2. (AF-M9-16) Starts the local HTTP fixture the reference-workflow
 *     acceptance suite runs against, so those graphs execute for real without
 *     touching the public internet. It lives here rather than in a suite's
 *     `beforeAll` because the task requires no new CI service and one server
 *     for the whole project — and returning the teardown is how vitest wants
 *     a global resource released.
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

  const fixture = await startFixtureServer();
  return async () => {
    await fixture.close();
  };
}
