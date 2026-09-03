import "server-only";
import {
  type BlobStore,
  resolveBlobStore,
} from "@/features/files/server/blob-store";
import { deleteFiles } from "@/features/files/server/file-service";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Plan } from "@/lib/quotas";
import {
  cutoffFor,
  PLAN_RETENTION,
  type RetentionPolicy,
  resolveRetention,
} from "@/lib/retention";

/**
 * Enforcement of the execution retention policy (AF-M8-06).
 *
 * The policy itself - which plan keeps what, for how long, and why the delete
 * window may never drop below the quota window - is in `src/lib/retention.ts`.
 * This module only applies it.
 *
 * Two properties are load-bearing:
 *
 * - **Bounded.** Every stage selects a page of ids and acts on that page, up
 *   to `maxBatches`. A sweep can leave work behind; it can never take an
 *   unbounded lock on the two largest tables in the database. Whatever is left
 *   is picked up by the next run.
 * - **Idempotent.** Redaction only selects rows that still have a payload, so
 *   a replayed step is a no-op rather than repeated work. Deletion is
 *   naturally idempotent - the row is gone.
 */

/** Rows touched per statement. Small enough to keep locks short. */
export const RETENTION_BATCH_SIZE = 500;

/** Pages per stage per run. Bounds one sweep; the next run continues. */
export const RETENTION_MAX_BATCHES = 40;

export interface RetentionSweepOptions {
  now?: Date;
  batchSize?: number;
  maxBatches?: number;
  /**
   * Blob store the run's files live in (AF-M10-06). Injected so a test can
   * point the sweep at a temp directory; production resolves the configured
   * one. Same reason `resolveNodeCredentials` takes its row loader.
   */
  store?: BlobStore;
}

export interface RetentionSweepResult {
  /** `Execution` rows whose own `input`/`output` were nulled. */
  redactedExecutions: number;
  /** `NodeExecution` rows whose `input`/`output` were nulled. */
  redactedNodeExecutions: number;
  /** `Execution` rows deleted (their `NodeExecution` rows cascade). */
  deletedExecutions: number;
  /** True when a stage hit `maxBatches` and more work remains. */
  truncated: boolean;
}

const EMPTY: RetentionSweepResult = {
  redactedExecutions: 0,
  redactedNodeExecutions: 0,
  deletedExecutions: 0,
  truncated: false,
};

/**
 * Matches a JSON column that still holds a payload.
 *
 * `Prisma.DbNull` is a SQL NULL - the state redaction leaves behind - as
 * distinct from `Prisma.JsonNull`, the JSON value `null`. Filtering on
 * `not: DbNull` is what makes redaction idempotent: an already-redacted row
 * stops matching, so repeated sweeps do not rewrite the same rows forever.
 */
const HAS_PAYLOAD = { not: Prisma.DbNull } as const;

/**
 * Null the `input`/`output` payloads on executions past their IO window.
 * Everything a dashboard reads - status, timings, tokens, cost, model, error
 * - is deliberately left in place.
 */
const redactIo = async (
  orgFilter: Prisma.ExecutionWhereInput,
  cutoff: Date,
  batchSize: number,
  maxBatches: number,
): Promise<{ executions: number; nodeExecutions: number; more: boolean }> => {
  let executions = 0;
  let nodeExecutions = 0;
  let more = false;

  for (let batch = 0; ; batch += 1) {
    if (batch >= maxBatches) {
      more = true;
      break;
    }

    const stale = await prisma.execution.findMany({
      where: {
        ...orgFilter,
        startedAt: { lt: cutoff },
        OR: [{ input: HAS_PAYLOAD }, { output: HAS_PAYLOAD }],
      },
      select: { id: true },
      take: batchSize,
    });

    if (stale.length === 0) {
      break;
    }

    const { count } = await prisma.execution.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { input: Prisma.DbNull, output: Prisma.DbNull },
    });
    executions += count;

    if (count === 0) {
      // Nothing changed despite matching rows: stop rather than spin.
      break;
    }
  }

  for (let batch = 0; ; batch += 1) {
    if (batch >= maxBatches) {
      more = true;
      break;
    }

    const stale = await prisma.nodeExecution.findMany({
      where: {
        execution: { ...orgFilter, startedAt: { lt: cutoff } },
        OR: [{ input: HAS_PAYLOAD }, { output: HAS_PAYLOAD }],
      },
      select: { id: true },
      take: batchSize,
    });

    if (stale.length === 0) {
      break;
    }

    const { count } = await prisma.nodeExecution.updateMany({
      where: { id: { in: stale.map((row) => row.id) } },
      data: { input: Prisma.DbNull, output: Prisma.DbNull },
    });
    nodeExecutions += count;

    if (count === 0) {
      break;
    }
  }

  return { executions, nodeExecutions, more };
};

/**
 * Delete executions past their delete window. `NodeExecution` follows by
 * `onDelete: Cascade`, which is why nothing here touches that table.
 *
 * Non-terminal rows are deleted too. A run older than the delete window (never
 * less than `QUOTA_SAFE_DELETE_FLOOR_DAYS`) cannot still be in flight - no
 * Inngest run lives for 35 days - so a row still marked `RUNNING` at that age
 * is a crashed run, and excluding it would leak exactly the rows that never
 * complete.
 */
const deleteExpired = async (
  orgFilter: Prisma.ExecutionWhereInput,
  cutoff: Date,
  batchSize: number,
  maxBatches: number,
  store?: BlobStore,
): Promise<{ deleted: number; more: boolean }> => {
  let deleted = 0;

  for (let batch = 0; ; batch += 1) {
    if (batch >= maxBatches) {
      return { deleted, more: true };
    }

    const expired = await prisma.execution.findMany({
      where: { ...orgFilter, startedAt: { lt: cutoff } },
      select: { id: true },
      take: batchSize,
    });

    if (expired.length === 0) {
      return { deleted, more: false };
    }

    // AF-M10-06: delete the run's blobs BEFORE the run itself. `StoredFile`
    // is `ON DELETE SET NULL` on `executionId` — deliberately, so a row
    // outlives its execution rather than vanishing with it — which means
    // deleting the execution first would orphan the file rows and leave the
    // bytes paid for and unreachable. Doing it here ties blob lifetime to the
    // AF-M8-06 retention window with no second sweep to keep in step.
    const expiredIds = expired.map((row) => row.id);
    const blobs = await prisma.storedFile.findMany({
      where: { executionId: { in: expiredIds } },
      select: { id: true },
    });
    if (blobs.length > 0) {
      await deleteFiles(
        blobs.map((blob) => blob.id),
        store ?? resolveBlobStore(),
      );
    }

    const { count } = await prisma.execution.deleteMany({
      where: { id: { in: expiredIds } },
    });
    deleted += count;

    if (count === 0) {
      return { deleted, more: false };
    }
  }
};

/**
 * Apply one plan's policy to the executions matched by `orgFilter`.
 *
 * Exported so a single org (or the null-organization legacy rows) can be swept
 * on its own, and so the integration tests can drive one plan at a time.
 */
export const applyRetentionPolicy = async (
  orgFilter: Prisma.ExecutionWhereInput,
  policy: Readonly<RetentionPolicy>,
  options: RetentionSweepOptions = {},
): Promise<RetentionSweepResult> => {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? RETENTION_MAX_BATCHES;

  const ioCutoff = cutoffFor(policy.ioRetentionDays, now);
  const deleteCutoff = cutoffFor(policy.deleteAfterDays, now);

  let result = { ...EMPTY };

  // Delete first: a row about to be deleted needs no redaction, and in this
  // order the redaction pass never pages through rows that are on their way
  // out.
  if (deleteCutoff) {
    const { deleted, more } = await deleteExpired(
      orgFilter,
      deleteCutoff,
      batchSize,
      maxBatches,
      options.store,
    );
    result = {
      ...result,
      deletedExecutions: deleted,
      truncated: result.truncated || more,
    };
  }

  if (ioCutoff) {
    const { executions, nodeExecutions, more } = await redactIo(
      orgFilter,
      ioCutoff,
      batchSize,
      maxBatches,
    );
    result = {
      ...result,
      redactedExecutions: executions,
      redactedNodeExecutions: nodeExecutions,
      truncated: result.truncated || more,
    };
  }

  return result;
};

const add = (
  a: RetentionSweepResult,
  b: RetentionSweepResult,
): RetentionSweepResult => ({
  redactedExecutions: a.redactedExecutions + b.redactedExecutions,
  redactedNodeExecutions: a.redactedNodeExecutions + b.redactedNodeExecutions,
  deletedExecutions: a.deletedExecutions + b.deletedExecutions,
  truncated: a.truncated || b.truncated,
});

/**
 * Sweep every organization, one plan at a time.
 *
 * Orgs are grouped by plan so each plan costs a bounded number of statements
 * rather than a pass per organization. Executions whose `organizationId` is
 * NULL - rows predating the AF-M7-pre-1 org backfill - are swept under FREE,
 * matching ADR-0010's rule that an unknown plan is never granted more.
 */
/**
 * Delete files whose explicit lifetime has passed (AF-M10-06).
 *
 * Most files inherit their lifetime from a run and are deleted by the stage
 * above. This covers the ones that never had a run to inherit from: an intake
 * form upload where the submitter abandoned the flow, or a download whose run
 * failed before the execution row existed. Without it those bytes are billed
 * forever and nothing ever looks for them.
 *
 * Bounded and idempotent like every other stage — the rows are gone, so a
 * replay is a no-op.
 */
export const sweepOrphanedFiles = async (
  options: { now?: Date; batchSize?: number; store?: BlobStore } = {},
): Promise<{ deletedFiles: number }> => {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? RETENTION_BATCH_SIZE;

  const expired = await prisma.storedFile.findMany({
    where: { executionId: null, expiresAt: { not: null, lt: now } },
    select: { id: true },
    take: batchSize,
  });

  if (expired.length === 0) {
    return { deletedFiles: 0 };
  }

  const deletedFiles = await deleteFiles(
    expired.map((row) => row.id),
    options.store ?? resolveBlobStore(),
  );
  return { deletedFiles };
};

export const sweepExecutionRetention = async (
  options: RetentionSweepOptions = {},
): Promise<RetentionSweepResult> => {
  let total = { ...EMPTY };

  for (const plan of Object.keys(PLAN_RETENTION) as Plan[]) {
    const orgs = await prisma.organization.findMany({
      where: { plan },
      select: { id: true },
    });

    if (orgs.length === 0) {
      continue;
    }

    total = add(
      total,
      await applyRetentionPolicy(
        { organizationId: { in: orgs.map((org) => org.id) } },
        PLAN_RETENTION[plan],
        options,
      ),
    );
  }

  total = add(
    total,
    await applyRetentionPolicy(
      { organizationId: null },
      resolveRetention(null),
      options,
    ),
  );

  logger.info("execution retention sweep complete", { ...total });
  return total;
};
