import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BlobNotFoundError,
  LocalBlobStore,
  resetBlobStore,
  resolveBlobStore,
  S3BlobStore,
} from "./blob-store";

describe("LocalBlobStore", () => {
  let root: string;
  let store: LocalBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "autoflow-blob-"));
    store = new LocalBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips bytes unchanged", async () => {
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe]);
    await store.put("org_1/2026-09/abc", data, "application/pdf");
    expect(await store.get("org_1/2026-09/abc")).toEqual(data);
  });

  it("writes under the org prefix, so tenancy is structural on disk", async () => {
    await store.put("org_1/2026-09/abc", Buffer.from("x"), "text/plain");
    expect(await readFile(join(root, "org_1", "2026-09", "abc"), "utf8")).toBe(
      "x",
    );
  });

  it("reports a missing key as BlobNotFoundError, not a raw fs error", async () => {
    await expect(store.get("org_1/2026-09/nope")).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
  });

  it("treats deleting an absent key as success", async () => {
    await expect(store.delete("org_1/2026-09/nope")).resolves.toBeUndefined();
  });

  it("answers exists() without reading the bytes", async () => {
    expect(await store.exists("org_1/2026-09/abc")).toBe(false);
    await store.put("org_1/2026-09/abc", Buffer.from("x"), "text/plain");
    expect(await store.exists("org_1/2026-09/abc")).toBe(true);
  });

  it("refuses a key that would escape the store root", async () => {
    // A key reaches the filesystem as a path. `..` in an object key is how a
    // tenant would read another tenant's files — or /etc/passwd.
    for (const key of [
      "../escape",
      "org_1/../../escape",
      "/absolute/path",
      "org_1/..%2fescape",
      "",
    ]) {
      await expect(
        store.put(key, Buffer.from("x"), "text/plain"),
        `key ${JSON.stringify(key)} must be refused`,
      ).rejects.toThrow(/unsafe object key|escapes/i);
    }
  });
});

describe("resolveBlobStore", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    resetBlobStore();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("BLOB_")) delete process.env[key];
    }
  });

  afterEach(() => {
    resetBlobStore();
    vi.unstubAllEnvs();
    process.env = { ...saved };
  });

  it("uses the local filesystem when no bucket is configured", () => {
    expect(resolveBlobStore()).toBeInstanceOf(LocalBlobStore);
    expect(resolveBlobStore().backend).toBe("local");
  });

  it("uses S3 when a bucket and credentials are present", () => {
    process.env.BLOB_S3_BUCKET = "files";
    process.env.BLOB_S3_ACCESS_KEY_ID = "key";
    process.env.BLOB_S3_SECRET_ACCESS_KEY = "secret";
    const store = resolveBlobStore();
    expect(store).toBeInstanceOf(S3BlobStore);
    expect(store.backend).toBe("s3");
  });

  it("selects by configuration, not by NODE_ENV", () => {
    // A production deploy that forgets the bucket would otherwise write to a
    // container filesystem that vanishes on the next deploy, and nobody finds
    // out until a user opens yesterday's run.
    process.env.BLOB_S3_BUCKET = "files";
    process.env.BLOB_S3_ACCESS_KEY_ID = "key";
    process.env.BLOB_S3_SECRET_ACCESS_KEY = "secret";
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveBlobStore()).toBeInstanceOf(S3BlobStore);
  });

  it("memoizes so every caller shares one store", () => {
    expect(resolveBlobStore()).toBe(resolveBlobStore());
  });
});
