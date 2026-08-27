// Test stub: the real "server-only" package throws when imported outside a
// React Server Component environment, which includes every vitest project.
// Aliased per-project in vitest.config.ts so unit tests can import server
// modules (node registry, executors). Production builds are unaffected.
export {};
