import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: __dirname,
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "@xyflow/react", "date-fns"],
  },

  /**
   * The PDF stack resolves things by path at runtime, and inlining it breaks
   * every one of them. pdfjs loads its worker from a relative specifier and
   * `@napi-rs/canvas` through a `createRequire(import.meta.url)`; webpack
   * rewrites neither, so once pdfjs is a chunk the worker specifier resolves
   * against `.next/server/chunks/` and the `createRequire` against the path
   * the BUILD machine had. Both point at nothing in the lambda. That produced
   * two production outages that no local run could reproduce, because in
   * `node_modules` - where every test and `next build` sees it - both resolve
   * correctly.
   *
   * Leaving the packages external is the fix for the class rather than for
   * each instance: they run from `node_modules` exactly as their authors
   * intended, so pdfjs resolves its own worker and polyfills `DOMMatrix`,
   * `ImageData` and `Path2D` from canvas on its own.
   *
   * `@napi-rs/canvas` has to be here regardless - it loads a
   * platform-specific `.node` binary through a require chosen at runtime, so
   * webpack cannot inline it at all.
   *
   * `src/features/knowledge/lib/extractor.ts` keeps working if this list is
   * edited; see the two guards there for what they do and why they stay.
   */
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse", "pdfjs-dist"],

  /**
   * ...and this is what puts the package there. Being external only means
   * "resolve it at runtime"; the tracer still has to copy it into the lambda,
   * and it reaches `@napi-rs/canvas` through requires it cannot follow - a
   * `createRequire` inside pdfjs, and the platform switch inside canvas
   * itself that picks the `.node` binary.
   *
   * Only the Inngest runner ever parses a PDF (knowledge ingestion and the
   * EXTRACT_TEXT / AI attachment executors), so only its trace needs the
   * native package. Both linux-x64 variants are listed because the build image
   * picks one and naming the wrong one alone would fail silently.
   */
  outputFileTracingIncludes: {
    "/api/inngest": [
      "./node_modules/@napi-rs/canvas/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
      "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "enra-doo",

  project: "nodebase",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
