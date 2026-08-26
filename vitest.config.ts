import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Each project spins up its own Vite server; root-level `resolve` is NOT
// inherited by inline projects, so the alias must be declared per project.
const alias = {
  "@": path.resolve(__dirname, "./src"),
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
          // Real Postgres work; keep unit runs fast and DB-independent.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
