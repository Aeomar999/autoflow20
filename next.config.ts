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
   * `@napi-rs/canvas` loads a platform-specific `.node` binary through a
   * `require` chosen at runtime, so webpack cannot inline it. Left to bundle,
   * it breaks; declared here, webpack emits a plain `require()` that Node
   * resolves from the chunk's own directory up into the lambda's
   * `node_modules` - which is the only resolution that works there, and the
   * reason `ensureDomMatrix` in the knowledge extractor can reach the package
   * when pdfjs itself cannot. See that function for the whole story.
   */
  serverExternalPackages: ["@napi-rs/canvas"],

  /**
   * ...and this is what puts the package there. `@napi-rs/canvas` is reached
   * only through the `await import()` in `ensureDomMatrix`, and its binary
   * through a runtime `require`, so the tracer needs telling.
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
