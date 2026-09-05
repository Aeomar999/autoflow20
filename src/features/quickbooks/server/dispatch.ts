import "server-only";
import { openSecret } from "@/features/credentials/server/vault";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  eventMatchesFilter,
  type IntuitEntityEvent,
  type IntuitRealmEvents,
} from "./webhook";

/**
 * Routing an Intuit notification to the workflows that asked for it
 * (AF-M10-16).
 *
 * Intuit posts to **one endpoint per app**, not per workflow, and the payload
 * names the company rather than the workflow. So unlike the Stripe and Google
 * Form routes — where the URL carries a per-workflow secret and the target is
 * known before the body is read — this has to work backwards: verify, then
 * find the credential holding that realm, then find the workflows whose
 * published graph binds it to a QuickBooks trigger.
 */

/** Loose shape of a published snapshot node; `graphSnapshot` is a Json column. */
type SnapshotNode = {
  id?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

export interface QboDispatchTarget {
  workflowId: string;
  organizationId: string;
  nodeId: string;
  events: IntuitEntityEvent[];
}

/**
 * A cap on how many runs one notification may start.
 *
 * Intuit batches, and a bulk import in QuickBooks can produce a notification
 * naming hundreds of entities. Without a ceiling one webhook could dispatch a
 * thousand runs against the org's quota before anyone noticed.
 */
export const MAX_EVENTS_PER_NOTIFICATION = 100;

/**
 * Credential ids for a realm, within one organization.
 *
 * Realms are looked up by decrypting candidate credentials rather than by a
 * `realmId` column, because the realm lives inside the sealed secret. That is
 * the right place for it — but it means the search is over Intuit credentials
 * only, which is what the `type` filter is for.
 */
export async function credentialIdsForRealm(
  realmId: string,
): Promise<Array<{ id: string; organizationId: string }>> {
  const candidates = await prisma.credential.findMany({
    where: { type: "intuit.oauth2" },
    select: {
      id: true,
      organizationId: true,
      ciphertext: true,
      iv: true,
      authTag: true,
      wrappedDek: true,
      keyVersion: true,
    },
  });

  const matches: Array<{ id: string; organizationId: string }> = [];

  for (const candidate of candidates) {
    if (!candidate.organizationId) continue;
    try {
      const secret = openSecret(candidate);
      if (secret.realmId === realmId) {
        matches.push({
          id: candidate.id,
          organizationId: candidate.organizationId,
        });
      }
    } catch (error) {
      // A credential sealed under a rotated master key cannot be opened. That
      // is a real problem for that credential, but it must not stop every
      // other company's events being delivered.
      logger.warn("QuickBooks webhook: could not open a credential", {
        credentialId: candidate.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return matches;
}

/**
 * Every published QBO trigger bound to one of these credentials, with the
 * events it asked for.
 *
 * A workflow whose filter excludes every event in the notification is not
 * returned at all: dispatching a run whose trigger data is an empty list would
 * burn quota to do nothing, and would make the execution list unreadable.
 */
export function collectQboTargets(args: {
  workflows: Array<{
    id: string;
    organizationId: string;
    activeVersion: { graphSnapshot: unknown } | null;
  }>;
  credentialIds: Set<string>;
  realm: IntuitRealmEvents;
}): QboDispatchTarget[] {
  const targets: QboDispatchTarget[] = [];

  for (const workflow of args.workflows) {
    if (!workflow.activeVersion?.graphSnapshot) continue;

    let nodes: SnapshotNode[];
    try {
      const snapshot =
        typeof workflow.activeVersion.graphSnapshot === "string"
          ? (JSON.parse(workflow.activeVersion.graphSnapshot) as {
              nodes?: SnapshotNode[];
            })
          : (workflow.activeVersion.graphSnapshot as {
              nodes?: SnapshotNode[];
            });
      nodes = snapshot.nodes ?? [];
    } catch (error) {
      logger.error(
        `QuickBooks webhook: failed to parse graphSnapshot for workflow ${workflow.id}`,
        { error },
      );
      continue;
    }

    for (const node of nodes) {
      if (node?.type !== "QBO_WEBHOOK_TRIGGER") continue;
      if (!node.id || node.disabled === true) continue;

      const credentialId = node.data?.credentialId;
      if (
        typeof credentialId !== "string" ||
        !args.credentialIds.has(credentialId)
      ) {
        // A trigger bound to a different company, or to nothing. Not an
        // error — one org can connect two QuickBooks companies.
        continue;
      }

      const filter = {
        entities: asStringArray(node.data?.entities),
        operations: asStringArray(node.data?.operations),
      };

      const events = args.realm.entities.filter((event) =>
        eventMatchesFilter(event, filter),
      );

      if (events.length > 0) {
        targets.push({
          workflowId: workflow.id,
          organizationId: workflow.organizationId,
          nodeId: node.id,
          events: events.slice(0, MAX_EVENTS_PER_NOTIFICATION),
        });
      }
    }
  }

  return targets;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/**
 * The trigger context a dispatched run starts with.
 *
 * One run per **entity event**, not per notification. A notification carrying
 * an invoice and a payment is two unrelated things to two different branches
 * of a workflow, and handing a graph a list it has to loop over would make the
 * common case — one record changed — the awkward one.
 */
export function qboTriggerContext(args: {
  realmId: string;
  event: IntuitEntityEvent;
}): Record<string, unknown> {
  return {
    qbo: {
      realmId: args.realmId,
      entity: args.event.name,
      entityId: args.event.id,
      operation: args.event.operation,
      lastUpdated: args.event.lastUpdated,
      ...(args.event.deletedId ? { deletedId: args.event.deletedId } : {}),
    },
  };
}
