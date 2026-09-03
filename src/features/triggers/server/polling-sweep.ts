import "server-only";
import { createHash } from "node:crypto";
import { resolveNodeCredentials } from "@/features/executions/server/credential-resolver";
import { sendWorkflowExecution } from "@/inngest/utils";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { type NodeRegistry, nodeRegistry } from "@/nodes/registry";
import {
  backoffSeconds,
  isPollDue,
  MAX_POLLS_PER_SWEEP,
  normalizeInterval,
  type PollableTrigger,
  runPoll,
  type TriggerStateSnapshot,
} from "./polling";

/**
 * Binding the polling framework to the database, the node registry and the
 * dispatcher (AF-M10-05).
 *
 * `polling.ts` holds the decisions; this file holds the I/O. The split is what
 * lets "does a second overlapping poll dispatch twice?" be a unit test rather
 * than an integration test with a fixture provider.
 */

/** Loose shape of a published snapshot node — `graphSnapshot` is a Json column. */
type SnapshotNode = {
  id?: string;
  name?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

export interface ActiveWorkflowForPolling {
  id: string;
  organizationId: string;
  activeVersion: { graphSnapshot: unknown } | null;
}

/**
 * Every polling trigger in a published graph.
 *
 * Pollers are discovered through the registry (`registration.polling`), not a
 * hard-coded list, so adding a connector is a node folder and nothing else.
 * A disabled trigger is skipped exactly as AF-M9-17 skips a disabled schedule
 * trigger — and silently, because the sweep ticks every minute and an
 * intentional authoring state is not an event.
 */
export function collectPollableTriggers(
  workflows: ActiveWorkflowForPolling[],
  // Injected so the discovery rules are testable against a stub registry
  // instead of whichever pollers production happens to register today —
  // the same reason `resolveNodeCredentials` takes its row loader.
  registry: Pick<NodeRegistry, "has" | "resolve"> = nodeRegistry,
): PollableTrigger[] {
  const triggers: PollableTrigger[] = [];

  for (const workflow of workflows) {
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
        `Failed to parse graphSnapshot for workflow ${workflow.id}`,
        { error },
      );
      continue;
    }

    for (const node of nodes) {
      if (!node?.type || !node.id || node.disabled === true) continue;
      if (!registry.has(node.type)) continue;

      const registration = registry.resolve(node.type);
      if (!registration.polling) continue;

      const data = node.data ?? {};
      triggers.push({
        workflowId: workflow.id,
        organizationId: workflow.organizationId,
        nodeId: node.id,
        nodeType: node.type,
        nodeName: node.name ?? node.type,
        config: data,
        intervalSeconds: normalizeInterval(
          data.pollIntervalSeconds ??
            registration.polling.defaultIntervalSeconds,
        ),
      });
    }
  }

  return triggers;
}

/**
 * What defines an item's identity for this trigger.
 *
 * Only fields that change what "the same item" means belong here — the sheet
 * and range being watched, the Gmail query, the Drive folder. A cosmetic edit
 * (renaming the node, changing the interval) must NOT clear the dedupe window,
 * because that would replay the backlog.
 */
const IDENTITY_KEYS = [
  "spreadsheetId",
  "sheetName",
  "range",
  "query",
  "labelIds",
  "folderId",
  "baseId",
  "tableId",
  "viewId",
  "calendarId",
  "dedupeKey",
] as const;

export function keyFingerprintOf(config: Record<string, unknown>): string {
  const identity: Record<string, unknown> = {};
  for (const key of IDENTITY_KEYS) {
    if (config[key] !== undefined) {
      identity[key] = config[key];
    }
  }
  return createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 32);
}

export interface SweepResult {
  polled: number;
  dispatched: number;
  failed: number;
  skipped: number;
}

/**
 * Poll every due trigger once and dispatch what is new.
 *
 * Ordering is oldest-polled-first so a large installation drains fairly rather
 * than always servicing whatever the database returned first.
 */
export async function sweepPollingTriggers(args: {
  workflows: ActiveWorkflowForPolling[];
  now: Date;
  maxPolls?: number;
  registry?: Pick<NodeRegistry, "has" | "resolve">;
}): Promise<SweepResult> {
  const { workflows, now } = args;
  const maxPolls = args.maxPolls ?? MAX_POLLS_PER_SWEEP;
  const registry = args.registry ?? nodeRegistry;

  const triggers = collectPollableTriggers(workflows, registry);
  if (triggers.length === 0) {
    return { polled: 0, dispatched: 0, failed: 0, skipped: 0 };
  }

  const states = await prisma.triggerState.findMany({
    where: { workflowId: { in: triggers.map((t) => t.workflowId) } },
  });
  const stateByKey = new Map(
    states.map((state) => [`${state.workflowId}:${state.nodeId}`, state]),
  );

  const due = triggers
    .filter((trigger) => {
      const row = stateByKey.get(`${trigger.workflowId}:${trigger.nodeId}`);
      const snapshot: TriggerStateSnapshot | null = row
        ? {
            cursor: row.cursor,
            lastSeenIds: row.lastSeenIds,
            lastPolledAt: row.lastPolledAt,
            failureCount: row.failureCount,
            nextPollAt: row.nextPollAt,
            keyFingerprint: row.keyFingerprint,
          }
        : null;
      return isPollDue(trigger, snapshot, now);
    })
    .sort((a, b) => {
      const left = stateByKey.get(`${a.workflowId}:${a.nodeId}`)?.lastPolledAt;
      const right = stateByKey.get(`${b.workflowId}:${b.nodeId}`)?.lastPolledAt;
      // Never-polled first, then oldest.
      return (left?.getTime() ?? 0) - (right?.getTime() ?? 0);
    });

  const result: SweepResult = {
    polled: 0,
    dispatched: 0,
    failed: 0,
    skipped: Math.max(due.length - maxPolls, 0),
  };

  for (const trigger of due.slice(0, maxPolls)) {
    const key = `${trigger.workflowId}:${trigger.nodeId}`;
    const row = stateByKey.get(key);
    const registration = registry.resolve(trigger.nodeType);
    const poller = registration.polling;
    if (!poller) continue;

    let credentials: Record<string, Record<string, string>> = {};
    try {
      credentials = await resolveNodeCredentials({
        requirements: registration.credentials,
        nodeData: trigger.config,
        userId: "",
        loadCredentialRow: (credentialId) =>
          prisma.credential.findUnique({
            where: {
              id: credentialId,
              organizationId: trigger.organizationId,
            },
          }),
      });
    } catch (error) {
      // A missing credential is a configuration problem, not a provider
      // outage, but it fails the same way and must back off the same way —
      // otherwise it is retried every minute forever.
      const message = error instanceof Error ? error.message : String(error);
      await persistFailure(trigger, row?.failureCount ?? 0, message, now);
      result.failed += 1;
      continue;
    }

    const outcome = await runPoll({
      trigger,
      poller,
      state: row
        ? {
            cursor: row.cursor,
            lastSeenIds: row.lastSeenIds,
            lastPolledAt: row.lastPolledAt,
            failureCount: row.failureCount,
            nextPollAt: row.nextPollAt,
            keyFingerprint: row.keyFingerprint,
          }
        : null,
      credentials,
      keyFingerprint: keyFingerprintOf(trigger.config),
      now,
    });

    result.polled += 1;
    if (outcome.error) {
      result.failed += 1;
      logger.warn(
        `Polling trigger failed for workflow ${trigger.workflowId} node ${trigger.nodeId}`,
        { error: outcome.error, nodeType: trigger.nodeType },
      );
    }

    // Persist BEFORE dispatching. If the process dies between the two, the
    // items are simply re-discovered on the next poll and suppressed by the id
    // window — whereas dispatching first and dying before the write replays
    // every run.
    await prisma.triggerState.upsert({
      where: {
        workflowId_nodeId: {
          workflowId: trigger.workflowId,
          nodeId: trigger.nodeId,
        },
      },
      create: {
        workflowId: trigger.workflowId,
        nodeId: trigger.nodeId,
        organizationId: trigger.organizationId,
        cursor: outcome.nextState.cursor as never,
        lastSeenIds: outcome.nextState.lastSeenIds,
        lastPolledAt: outcome.nextState.lastPolledAt,
        failureCount: outcome.nextState.failureCount,
        lastError: outcome.nextState.lastError,
        nextPollAt: outcome.nextState.nextPollAt,
        keyFingerprint: outcome.nextState.keyFingerprint,
      },
      update: {
        cursor: outcome.nextState.cursor as never,
        lastSeenIds: outcome.nextState.lastSeenIds,
        lastPolledAt: outcome.nextState.lastPolledAt,
        failureCount: outcome.nextState.failureCount,
        lastError: outcome.nextState.lastError,
        nextPollAt: outcome.nextState.nextPollAt,
        keyFingerprint: outcome.nextState.keyFingerprint,
      },
    });

    for (const item of outcome.dispatch) {
      await sendWorkflowExecution({
        workflowId: trigger.workflowId,
        organizationId: trigger.organizationId,
        initialData: {
          trigger: {
            nodeId: trigger.nodeId,
            nodeType: trigger.nodeType,
            itemId: item.id,
            polledAt: now.toISOString(),
          },
          // The item's own payload is what templates address, so it lands at
          // the top level alongside the trigger metadata rather than nested
          // under it.
          ...(item.data && typeof item.data === "object"
            ? (item.data as Record<string, unknown>)
            : { value: item.data }),
        },
      });
      result.dispatched += 1;
    }
  }

  return result;
}

async function persistFailure(
  trigger: PollableTrigger,
  previousFailures: number,
  message: string,
  now: Date,
): Promise<void> {
  const failureCount = previousFailures + 1;
  const nextPollAt = new Date(
    now.getTime() +
      backoffSeconds(failureCount, trigger.intervalSeconds) * 1000,
  );
  await prisma.triggerState.upsert({
    where: {
      workflowId_nodeId: {
        workflowId: trigger.workflowId,
        nodeId: trigger.nodeId,
      },
    },
    create: {
      workflowId: trigger.workflowId,
      nodeId: trigger.nodeId,
      organizationId: trigger.organizationId,
      lastPolledAt: now,
      failureCount,
      lastError: message.slice(0, 1000),
      nextPollAt,
      keyFingerprint: keyFingerprintOf(trigger.config),
    },
    update: {
      lastPolledAt: now,
      failureCount,
      lastError: message.slice(0, 1000),
      nextPollAt,
    },
  });
}
