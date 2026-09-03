import "server-only";
import { createHash } from "node:crypto";
import prisma from "@/lib/db";

/**
 * The seen-key store behind the `DEDUPE` node (AF-M10-10).
 *
 * Same table as the polling framework (`TriggerState`, keyed by
 * `(workflowId, nodeId)`) because it is the same question asked at a different
 * point in the graph: have we already handled this? A second table would be a
 * second implementation of the window, the fingerprint and the bound.
 *
 * The polling columns this reuses:
 *  - `lastSeenIds` — the keys already handled
 *  - `keyFingerprint` — what "the same item" currently means
 *  - `lastPolledAt` — last time this node ran, for operator visibility
 */

/** Keys retained in `window` mode when the node does not say. */
export const DEFAULT_DEDUPE_WINDOW = 1000;

/**
 * Hard ceiling on retained keys, `forever` included.
 *
 * "Forever" is a promise no single row can keep: `lastSeenIds` is read and
 * rewritten on every run, so an unbounded array is a row that grows until it
 * is too slow to load. 10,000 keys is roughly 400 KB — large enough that no
 * realistic workflow reaches it in the retention window, small enough to read
 * on every run. The cap is stated in the node's docs rather than implied.
 */
export const MAX_DEDUPE_KEYS = 10_000;

export interface DedupeResult {
  /** Keys not seen before, in input order. */
  fresh: string[];
  /** Keys suppressed because they were already handled. */
  duplicates: string[];
  /** True when a changed key expression cleared the window on this call. */
  reset: boolean;
}

/** What "the same item" means: the key expression, plus the mode. */
export function dedupeFingerprint(args: {
  keyExpression: string;
  mode: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([args.keyExpression, args.mode]))
    .digest("hex")
    .slice(0, 32);
}

/**
 * Record `keys` as handled and report which were new.
 *
 * One read-modify-write against the node's row. Concurrency is bounded by the
 * engine: a workflow's runs are not parallel within a node, and two runs
 * racing here would at worst let one duplicate through — which is the same
 * guarantee the polling framework gives (at-least-once, deduplicated), not a
 * stronger claim this could not keep.
 */
export async function recordSeenKeys(args: {
  workflowId: string;
  nodeId: string;
  organizationId: string;
  keys: string[];
  fingerprint: string;
  /** `forever` keeps every key up to the ceiling; `window` keeps the last N. */
  windowSize: number;
  now?: Date;
}): Promise<DedupeResult> {
  const now = args.now ?? new Date();
  const limit = Math.min(Math.max(args.windowSize, 1), MAX_DEDUPE_KEYS);

  const existing = await prisma.triggerState.findUnique({
    where: {
      workflowId_nodeId: {
        workflowId: args.workflowId,
        nodeId: args.nodeId,
      },
    },
    select: { lastSeenIds: true, keyFingerprint: true },
  });

  // A changed key expression means the stored keys answer a different
  // question. Keeping them would suppress items the new key has never seen —
  // silently, and only for the items that happen to collide.
  const reset =
    existing !== null &&
    existing.keyFingerprint !== null &&
    existing.keyFingerprint !== args.fingerprint;

  const seen = new Set(reset ? [] : (existing?.lastSeenIds ?? []));

  const fresh: string[] = [];
  const duplicates: string[] = [];
  for (const key of args.keys) {
    if (seen.has(key)) {
      duplicates.push(key);
      continue;
    }
    seen.add(key);
    fresh.push(key);
  }

  if (fresh.length > 0 || reset) {
    const retained = [
      ...(reset ? [] : (existing?.lastSeenIds ?? [])),
      ...fresh,
    ].slice(-limit);

    await prisma.triggerState.upsert({
      where: {
        workflowId_nodeId: {
          workflowId: args.workflowId,
          nodeId: args.nodeId,
        },
      },
      create: {
        workflowId: args.workflowId,
        nodeId: args.nodeId,
        organizationId: args.organizationId,
        lastSeenIds: retained,
        keyFingerprint: args.fingerprint,
        lastPolledAt: now,
      },
      update: {
        lastSeenIds: retained,
        keyFingerprint: args.fingerprint,
        lastPolledAt: now,
      },
    });
  }

  return { fresh, duplicates, reset };
}
