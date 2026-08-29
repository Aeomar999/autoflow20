process.env.SKIP_ENV_VALIDATION = "1";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup only registers when `afterEach` is a global (needs
// `globals: true`). It isn't here, so clean up explicitly or rendered
// containers accumulate across tests inside the same file.
afterEach(() => cleanup());
