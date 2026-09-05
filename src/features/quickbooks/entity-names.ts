/**
 * QBO entity names, isomorphic (AF-M10-16).
 *
 * Split out of `server/entities.ts` because node *definitions* run on the
 * client — the schema-driven config panel builds its dropdown from this list —
 * and `entities.ts` carries `server-only`. Same reason
 * `knowledge/server/vector-store-ids.ts` exists.
 */

/**
 * Entity types a node may name, mapping the response key to the URL path.
 *
 * An allowlist rather than free text for two reasons. `QBO_GET` builds a URL
 * path from this value, and a template that resolved to `"../../otherCompany/
 * customer/1"` would otherwise walk out of the realm the credential
 * authorises. And QBO's paths are lower case while its response keys are
 * capitalised (`salesreceipt` → `SalesReceipt`), which is exactly the kind of
 * asymmetry people get wrong once and then debug for an hour.
 */
export const QBO_ENTITIES = {
  Customer: "customer",
  Invoice: "invoice",
  Estimate: "estimate",
  SalesReceipt: "salesreceipt",
  Payment: "payment",
  Item: "item",
  Vendor: "vendor",
  Bill: "bill",
  Purchase: "purchase",
  Account: "account",
} as const;

export type QboEntity = keyof typeof QBO_ENTITIES;

export const QBO_ENTITY_NAMES = Object.keys(QBO_ENTITIES) as [
  QboEntity,
  ...QboEntity[],
];

export const isQboEntity = (value: string): value is QboEntity =>
  Object.hasOwn(QBO_ENTITIES, value);
