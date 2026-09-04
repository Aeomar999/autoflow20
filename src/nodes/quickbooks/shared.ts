/**
 * Shared config vocabulary for the QuickBooks nodes (AF-M10-16).
 *
 * **Client-safe, and enforced as such.** Node `definition.ts` files import this
 * module, and definitions reach `manifest.ts` → `node-selector.tsx` → the
 * editor, which is a client component. So this file may contain no value
 * import from a server-only package — which is why the entity map lives in
 * `@/features/quickbooks/entity-names` and the run-time parsers (which throw
 * `inngest`'s `NonRetriableError`) live in `./parse`.
 *
 * This is not a hypothetical. A `NonRetriableError` import here shipped, and
 * webpack failed the production build on `node:async_hooks` — reached through
 * `inngest`'s entry point — while `tsc`, Biome and the test suite all stayed
 * green, because none of them model the client/server boundary.
 * `client-boundary.test.ts` does.
 */

/** One line on an invoice, estimate or sales receipt. */
export interface QboLineInput {
  description?: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
  /** QBO Item id. */
  itemId?: string;
}

export const QBO_CREDENTIAL_TYPE = "intuit.oauth2";

export const QBO_LOGO = "/logos/quickbooks.png";
