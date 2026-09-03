import { beforeEach, describe, expect, it } from "vitest";
import {
  dedupeFingerprint,
  MAX_DEDUPE_KEYS,
  recordSeenKeys,
} from "@/features/triggers/server/dedupe-store";
import prisma from "@/lib/db";

/**
 * AF-M10-10's store against a real Postgres.
 *
 * What needs a database: that the window actually survives between runs (the
 * whole point of the node), that it is scoped per node rather than per
 * workflow, and that a changed key expression clears it — none of which a
 * fake can prove, because a fake is written by the same person who wrote the
 * assumption.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("dedupe store (AF-M10-10)", () => {
  let organizationId: string;
  let workflowId: string;

  const fingerprint = dedupeFingerprint({
    keyExpression: "email",
    mode: "forever",
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "TriggerState","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    await prisma.user.create({
      data: {
        id: "user_dedupe",
        email: "dedupe@test.local",
        name: "Dedupe",
        emailVerified: true,
      },
    });
    const org = await prisma.organization.create({
      data: {
        name: "Dedupe Org",
        slug: "dedupe-org",
        members: { create: { userId: "user_dedupe", role: "OWNER" } },
      },
    });
    organizationId = org.id;

    const workflow = await prisma.workflow.create({
      data: { name: "Dedupe", userId: "user_dedupe", organizationId },
    });
    workflowId = workflow.id;
  });

  const record = (
    keys: string[],
    over: { nodeId?: string; fingerprint?: string; windowSize?: number } = {},
  ) =>
    recordSeenKeys({
      workflowId,
      nodeId: over.nodeId ?? "node_a",
      organizationId,
      keys,
      fingerprint: over.fingerprint ?? fingerprint,
      windowSize: over.windowSize ?? MAX_DEDUPE_KEYS,
    });

  it("remembers keys between calls", async () => {
    expect((await record(["a", "b"])).fresh).toEqual(["a", "b"]);
    const second = await record(["b", "c"]);
    expect(second.fresh).toEqual(["c"]);
    expect(second.duplicates).toEqual(["b"]);
  });

  it("collapses repeats inside one batch", async () => {
    const result = await record(["a", "a", "b"]);
    expect(result.fresh).toEqual(["a", "b"]);
    expect(result.duplicates).toEqual(["a"]);
  });

  it("scopes the window per node, not per workflow", async () => {
    await record(["a"], { nodeId: "node_a" });
    // A second DEDUPE in the same workflow asks a different question; sharing
    // a window would make it drop everything the first one saw.
    expect((await record(["a"], { nodeId: "node_b" })).fresh).toEqual(["a"]);
  });

  it("clears the window when the key expression changes", async () => {
    await record(["a", "b"]);

    const other = dedupeFingerprint({
      keyExpression: "customerId",
      mode: "forever",
    });
    const result = await record(["a"], { fingerprint: other });

    // The stored keys answered a different question. Keeping them would
    // suppress items the new key has never seen — silently, and only for the
    // ones that happen to collide.
    expect(result.reset).toBe(true);
    expect(result.fresh).toEqual(["a"]);

    const row = await prisma.triggerState.findUniqueOrThrow({
      where: { workflowId_nodeId: { workflowId, nodeId: "node_a" } },
    });
    expect(row.lastSeenIds).toEqual(["a"]);
    expect(row.keyFingerprint).toBe(other);
  });

  it("does not clear the window for the same expression", async () => {
    await record(["a"]);
    expect((await record(["a"])).reset).toBe(false);
  });

  it("keeps only the most recent keys in window mode", async () => {
    await record(["a", "b", "c"], { windowSize: 2 });
    const row = await prisma.triggerState.findUniqueOrThrow({
      where: { workflowId_nodeId: { workflowId, nodeId: "node_a" } },
    });
    expect(row.lastSeenIds).toEqual(["b", "c"]);

    // "a" has aged out of the window, so it counts as fresh again — which is
    // exactly what `window` mode promises.
    expect((await record(["a"], { windowSize: 2 })).fresh).toEqual(["a"]);
  });

  it("writes nothing when every key is a duplicate", async () => {
    await record(["a"]);
    const before = await prisma.triggerState.findUniqueOrThrow({
      where: { workflowId_nodeId: { workflowId, nodeId: "node_a" } },
    });

    await record(["a"]);
    const after = await prisma.triggerState.findUniqueOrThrow({
      where: { workflowId_nodeId: { workflowId, nodeId: "node_a" } },
    });
    // A no-op batch must not churn the row: this runs on every poll of every
    // workflow, and a pointless write per run is a write amplification bug.
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("shares its table with the polling framework without colliding", async () => {
    // Both key on (workflowId, nodeId) by design — same question, different
    // point in the graph. A polling trigger and a DEDUPE node in one workflow
    // must still be independent rows.
    await record(["a"], { nodeId: "trigger_node" });
    await record(["a"], { nodeId: "dedupe_node" });

    const rows = await prisma.triggerState.findMany({ where: { workflowId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.organizationId === organizationId)).toBe(
      true,
    );
  });
});
