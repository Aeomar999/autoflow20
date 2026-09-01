import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Each project spins up its own Vite server; root-level `resolve` is NOT
// inherited by inline projects, so the alias must be declared per project.
const alias = {
  "@": path.resolve(__dirname, "./src"),
  // The real package throws outside RSC rendering; tests import server
  // modules (e.g. src/nodes/registry.ts) directly, so stub it everywhere.
  "server-only": path.resolve(__dirname, "./vitest.server-only-stub.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.dom.test.{ts,tsx}"],
          environment: "node",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          setupFiles: ["./vitest.integration.setup.ts"],
          // Migrations are deployed once before any worker starts, so suites
          // parallel workers no longer race a schema that does not exist yet.
          globalSetup: ["./vitest.integration.global-setup.ts"],
          // Real Postgres work; keep unit runs fast and DB-independent.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // One shared Postgres, and every suite TRUNCATEs the whole schema
          // in beforeEach. Parallel files would deadlock and clobber each
          // other's fixtures, so integration files run strictly serially.
          //
          // AF-M8-18: `fileParallelism: false` is documented as forcing
          // `maxWorkers` to 1, but on its own it did not hold once the unit
          // and dom projects ran alongside this one - files still interleaved,
          // and one suite's TRUNCATE landed between another's user insert and
          // its organization insert, surfacing as a `member_userId_fkey`
          // violation. That is the failure AF-M8-02 recorded as a
          // "pre-existing environment/DB-state issue" in the api-keys and
          // public-api suites. Capping the workers explicitly is what holds.
          fileParallelism: false,
          maxWorkers: 1,
          pool: "forks",
        },
      },
    ],
  },
});
