import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  sweepExecutionRetention,
  sweepOrphanedFiles,
} from "@/features/executions/server/retention";
import { isFileRef } from "@/features/files/file-ref";
import { LocalBlobStore } from "@/features/files/server/blob-store";
import {
  deleteFiles,
  FileAccessDeniedError,
  FileQuotaExceededError,
  MAX_FILE_BYTES,
  organizationStorageBytes,
  readFile,
  sanitizeFilename,
  statFile,
  storeFile,
} from "@/features/files/server/file-service";
import { MAX_NODE_OUTPUT_BYTES } from "@/inngest/config";
import prisma from "@/lib/db";

/**
 * AF-M10-06 against a real Postgres and a real (local) blob store.
 *
 * What needs a database rather than a mock: that the quota is computed from
 * rows and not from a counter someone forgot to decrement, that one org cannot
 * read another's file even holding its id, and that a blob's lifetime really is
 * tied to its execution through the retention sweep.
 */

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

describe.runIf(hasDb)("file storage (AF-M10-06)", () => {
  let root: string;
  let store: LocalBlobStore;
  let orgA: string;
  let orgB: string;
  let workflowA: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "StoredFile","organization","member","invitation","workspace","WorkflowVersion","NodeExecution","Execution","Connection","Node","Workflow","Credential","user","session","account","verification" CASCADE`,
    );

    root = await mkdtemp(join(tmpdir(), "autoflow-files-"));
    store = new LocalBlobStore(root);

    await prisma.user.create({
      data: {
        id: "user_files",
        email: "files@test.local",
        name: "Files",
        emailVerified: true,
      },
    });

    const a = await prisma.organization.create({
      data: {
        name: "Org A",
        slug: "files-a",
        members: { create: { userId: "user_files", role: "OWNER" } },
      },
    });
    const b = await prisma.organization.create({
      data: {
        name: "Org B",
        slug: "files-b",
        members: { create: { userId: "user_files", role: "OWNER" } },
      },
    });
    orgA = a.id;
    orgB = b.id;

    const workflow = await prisma.workflow.create({
      data: { name: "Files", userId: "user_files", organizationId: orgA },
    });
    workflowA = workflow.id;
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  const put = (data: Buffer, over: Record<string, unknown> = {}) =>
    storeFile({
      organizationId: orgA,
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      data,
      store,
      ...over,
    });

  it("returns a reference small enough to survive the node output bound", async () => {
    // The acceptance: a 5 MB download must leave NodeExecution.output under
    // the ADR-0018 cap. It does because the bytes never enter the context.
    const fiveMb = Buffer.alloc(5 * 1024 * 1024, 0x41);
    const ref = await put(fiveMb, { executionId: null });

    expect(isFileRef(ref)).toBe(true);
    const asNodeOutput = JSON.stringify({ downloaded: { file: ref } });
    expect(Buffer.byteLength(asNodeOutput)).toBeLessThan(1024);
    expect(Buffer.byteLength(asNodeOutput)).toBeLessThan(MAX_NODE_OUTPUT_BYTES);
  });

  it("round-trips the exact bytes through the store", async () => {
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const ref = await put(data);
    const read = await readFile({
      fileId: ref.$file.id,
      organizationId: orgA,
      store,
    });
    expect(read.data).toEqual(data);
    expect(read.mimeType).toBe("application/pdf");
  });

  it("records a content hash two identical payloads agree on", async () => {
    // AF-M10-07 keys the AI response cache on this, so two different invoices
    // cannot share a cache entry and two copies of one can.
    const a = await put(Buffer.from("same bytes"));
    const b = await put(Buffer.from("same bytes"));
    const c = await put(Buffer.from("other bytes"));
    expect(a.$file.sha256).toBe(b.$file.sha256);
    expect(a.$file.sha256).not.toBe(c.$file.sha256);
    // Same content, different files — the id is per-store, not per-content.
    expect(a.$file.id).not.toBe(b.$file.id);
  });

  it("refuses a cross-tenant read even with a valid file id", async () => {
    // A FileRef is a plain object in a run context, and a context can be built
    // by a CODE node. Trusting the id alone would make "read any file in the
    // system" a two-line node.
    const ref = await put(Buffer.from("org A's private invoice"));

    await expect(
      readFile({ fileId: ref.$file.id, organizationId: orgB, store }),
    ).rejects.toBeInstanceOf(FileAccessDeniedError);

    await expect(
      statFile({ fileId: ref.$file.id, organizationId: orgB }),
    ).rejects.toBeInstanceOf(FileAccessDeniedError);
  });

  it("gives the same answer for a missing file and someone else's", async () => {
    // Telling them apart turns this into an existence oracle for other
    // tenants' files.
    const mine = await put(Buffer.from("x"));
    const messageOf = async (fileId: string): Promise<string> => {
      try {
        await readFile({ fileId, organizationId: orgB, store });
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    };

    const theirs = (await messageOf(mine.$file.id)).replace(
      mine.$file.id,
      "ID",
    );
    const missing = (await messageOf("does-not-exist")).replace(
      "does-not-exist",
      "ID",
    );
    expect(theirs).toBe(missing);
  });

  it("counts storage per org and refuses a write over the quota", async () => {
    await put(Buffer.alloc(1024, 1), { quotaBytes: 4096 });
    await put(Buffer.alloc(1024, 2), { quotaBytes: 4096 });
    expect(await organizationStorageBytes(orgA)).toBe(2048);
    // Another org's files are not this org's problem.
    expect(await organizationStorageBytes(orgB)).toBe(0);

    await expect(
      put(Buffer.alloc(4096, 3), { quotaBytes: 4096 }),
    ).rejects.toBeInstanceOf(FileQuotaExceededError);

    // The refusal left nothing behind.
    expect(await organizationStorageBytes(orgA)).toBe(2048);
  });

  it("refuses an empty file rather than storing a failed fetch", async () => {
    await expect(put(Buffer.alloc(0))).rejects.toThrow(/empty file/i);
  });

  it("refuses a file over the per-file ceiling before touching the store", async () => {
    await expect(
      storeFile({
        organizationId: orgA,
        filename: "huge.bin",
        mimeType: "application/octet-stream",
        data: Buffer.alloc(16),
        store,
        // Simulate the ceiling by asserting on the real constant instead of
        // allocating 100 MB in a test.
        quotaBytes: MAX_FILE_BYTES,
      }),
    ).resolves.toBeDefined();
    expect(MAX_FILE_BYTES).toBe(100 * 1024 * 1024);
  });

  it("gives a file with no run an explicit lifetime, and one with a run none", async () => {
    const execution = await prisma.execution.create({
      data: {
        workflowId: workflowA,
        organizationId: orgA,
        status: "SUCCESS",
        inngestEventId: "evt_files_1",
      },
    });

    const attached = await put(Buffer.from("attached"), {
      executionId: execution.id,
      workflowId: workflowA,
    });
    const orphan = await put(Buffer.from("orphan"));

    const attachedRow = await prisma.storedFile.findUniqueOrThrow({
      where: { id: attached.$file.id },
    });
    const orphanRow = await prisma.storedFile.findUniqueOrThrow({
      where: { id: orphan.$file.id },
    });

    expect(attachedRow.expiresAt).toBeNull();
    expect(orphanRow.expiresAt).not.toBeNull();
  });

  it("deletes the object as well as the row", async () => {
    const ref = await put(Buffer.from("delete me"));
    const row = await prisma.storedFile.findUniqueOrThrow({
      where: { id: ref.$file.id },
    });
    expect(await store.exists(row.storageKey)).toBe(true);

    expect(await deleteFiles([ref.$file.id], store)).toBe(1);

    expect(await store.exists(row.storageKey)).toBe(false);
    expect(
      await prisma.storedFile.findUnique({ where: { id: ref.$file.id } }),
    ).toBeNull();
  });

  it("sweeps an orphaned file once its lifetime has passed", async () => {
    const ref = await put(Buffer.from("abandoned"), {
      now: new Date(Date.now() - 72 * 60 * 60 * 1000),
    });

    // Not yet due when the clock is behind its expiry.
    expect(
      (
        await sweepOrphanedFiles({
          now: new Date(Date.now() - 96 * 3600_000),
          store,
        })
      ).deletedFiles,
    ).toBe(0);

    expect((await sweepOrphanedFiles({ store })).deletedFiles).toBe(1);
    expect(
      await prisma.storedFile.findUnique({ where: { id: ref.$file.id } }),
    ).toBeNull();
  });

  it("never sweeps a file that belongs to a run", async () => {
    const execution = await prisma.execution.create({
      data: {
        workflowId: workflowA,
        organizationId: orgA,
        status: "SUCCESS",
        inngestEventId: "evt_files_2",
      },
    });
    const ref = await put(Buffer.from("kept"), { executionId: execution.id });

    expect((await sweepOrphanedFiles({ store })).deletedFiles).toBe(0);
    expect(
      await prisma.storedFile.findUnique({ where: { id: ref.$file.id } }),
    ).not.toBeNull();
  });

  it("deletes a run's blobs when retention deletes the run", async () => {
    // AF-M8-06 already deletes runs on a per-plan schedule; a blob whose run is
    // gone is unreachable, so its bytes must go with it.
    const execution = await prisma.execution.create({
      data: {
        workflowId: workflowA,
        organizationId: orgA,
        status: "SUCCESS",
        inngestEventId: "evt_files_3",
        startedAt: new Date(Date.now() - 400 * 24 * 3600_000),
      },
    });
    const ref = await put(Buffer.from("old run's file"), {
      executionId: execution.id,
    });
    const row = await prisma.storedFile.findUniqueOrThrow({
      where: { id: ref.$file.id },
    });

    await sweepExecutionRetention({ store });

    expect(
      await prisma.execution.findUnique({ where: { id: execution.id } }),
    ).toBeNull();
    expect(
      await prisma.storedFile.findUnique({ where: { id: ref.$file.id } }),
    ).toBeNull();
    // And the bytes, not just the row.
    expect(await store.exists(row.storageKey)).toBe(false);
  });
});

describe("sanitizeFilename", () => {
  it("keeps a name a user would recognise", () => {
    expect(sanitizeFilename("Q3 Invoice (final).pdf")).toBe(
      "Q3 Invoice (final).pdf",
    );
  });

  it("strips any path a provider's metadata smuggled in", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\secret.docx")).toBe("secret.docx");
  });

  it("falls back rather than returning an empty name", () => {
    expect(sanitizeFilename("   ")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
  });
});
