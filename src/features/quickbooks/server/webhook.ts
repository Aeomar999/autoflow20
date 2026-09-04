import "server-only";
import { verifyHmacSignature } from "@/lib/server/webhook-signature";

/**
 * Intuit webhook verification (AF-M10-16).
 *
 * Intuit's model is one endpoint per *app*, not per workflow: every connected
 * company's events arrive at the same URL, and the payload names the realm
 * they belong to. That means the URL cannot carry a per-workflow secret the
 * way the Stripe and Google Form routes do — the signature is the only proof,
 * and routing happens afterwards by realm.
 */

export interface IntuitEntityEvent {
  /** QBO entity name, e.g. "Invoice". */
  name: string;
  id: string;
  /** "Create" | "Update" | "Delete" | "Merge" | "Void" | "Emailed". */
  operation: string;
  lastUpdated: string;
  /** Present on a Merge: the id the record was merged into. */
  deletedId?: string;
}

export interface IntuitRealmEvents {
  realmId: string;
  entities: IntuitEntityEvent[];
}

/**
 * Verify Intuit's `intuit-signature` header.
 *
 * The header is the base64 HMAC-SHA256 of the **raw request body** under the
 * app's verifier token. Raw matters: `JSON.parse` then `JSON.stringify` gives
 * a byte-for-byte different document (key order, whitespace, number
 * formatting) and every signature check would fail for reasons that look like
 * a wrong token.
 *
 * The comparison itself lives in `verifyHmacSignature` (AF-M10-18) and is
 * constant-time. A byte-by-byte early return leaks how much of a forged
 * signature was correct, which is enough to construct one a byte at a time —
 * so there is one such comparison in the codebase, not one per provider.
 */
export function verifyIntuitSignature(args: {
  rawBody: string;
  signature: string | null;
  verifierToken: string;
}): boolean {
  return verifyHmacSignature({
    rawBody: args.rawBody,
    signature: args.signature,
    secret: args.verifierToken,
    encoding: "base64",
  });
}

/**
 * Pull the per-realm entity events out of an Intuit notification.
 *
 * One notification can carry several realms, and each realm several entities:
 * Intuit batches, so an invoice created and then emailed inside the polling
 * window arrives as two entity events in one request.
 */
export function parseIntuitNotification(body: unknown): IntuitRealmEvents[] {
  if (!body || typeof body !== "object") return [];

  const notifications = (
    body as {
      eventNotifications?: Array<{
        realmId?: string;
        dataChangeEvent?: {
          entities?: Array<Record<string, unknown>>;
        };
      }>;
    }
  ).eventNotifications;

  if (!Array.isArray(notifications)) return [];

  const result: IntuitRealmEvents[] = [];

  for (const notification of notifications) {
    const realmId = notification?.realmId;
    if (typeof realmId !== "string" || realmId.length === 0) continue;

    const entities: IntuitEntityEvent[] = [];
    for (const entity of notification.dataChangeEvent?.entities ?? []) {
      const name = entity?.name;
      const id = entity?.id;
      const operation = entity?.operation;
      if (
        typeof name !== "string" ||
        typeof id !== "string" ||
        typeof operation !== "string"
      ) {
        continue;
      }
      entities.push({
        name,
        id,
        operation,
        lastUpdated:
          typeof entity.lastUpdated === "string" ? entity.lastUpdated : "",
        ...(typeof entity.deletedId === "string"
          ? { deletedId: entity.deletedId }
          : {}),
      });
    }

    if (entities.length > 0) {
      result.push({ realmId, entities });
    }
  }

  return result;
}

/**
 * Does this event match what the trigger asked for?
 *
 * Both filters are "any" when empty. A trigger that named no entity wants
 * every entity, which is the useful default for "tell me when anything
 * changes" — and is why the node's description says to narrow it.
 */
export function eventMatchesFilter(
  event: IntuitEntityEvent,
  filter: { entities?: string[]; operations?: string[] },
): boolean {
  const entities = filter.entities?.filter(Boolean) ?? [];
  const operations = filter.operations?.filter(Boolean) ?? [];

  if (
    entities.length > 0 &&
    !entities.some((name) => name.toLowerCase() === event.name.toLowerCase())
  ) {
    return false;
  }
  if (
    operations.length > 0 &&
    !operations.some(
      (operation) => operation.toLowerCase() === event.operation.toLowerCase(),
    )
  ) {
    return false;
  }
  return true;
}
