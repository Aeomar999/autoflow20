process.env.SKIP_ENV_VALIDATION = "1";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// RTL auto-cleanup only registers when `afterEach` is a global (needs
// `globals: true`). It isn't here, so clean up explicitly or rendered
// containers accumulate across tests inside the same file.
afterEach(() => cleanup());

// jsdom implements no ResizeObserver, and recharts' ResponsiveContainer
// constructs one on mount — so any component rendering a chart throws before
// its assertions run. The stub reports nothing, which is correct for jsdom:
// there is no layout, so a chart legitimately has no measurable size and
// renders no plot area. Assert on the surrounding copy, not on plotted marks.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
