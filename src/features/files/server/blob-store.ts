import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";

/**
 * Blob storage behind one interface (AF-M10-06, ADR-0025).
 *
 * Two implementations: the local filesystem for dev and CI, and any
 * S3-compatible object store for staging and production. Which one runs is an
 * env decision made once, in `resolveBlobStore`.
 *
 * **No provider SDK type appears in this interface, or in anything that
 * consumes it.** `Buffer` in; `Buffer` or a web `ReadableStream` out; string
 * keys. That is what makes the local store a real implementation rather than a
 * mock, and it is why the file-service tests run with no network and no
 * container.
 *
 * `getStream` was added in AF-M10-22 for the social publishing nodes: a video
 * buffered whole is worker heap proportional to the file, and `Readable.toWeb`
 * / `transformToWebStream` mean the bytes go store → socket instead.
 */

export interface BlobStore {
  /** Backend id recorded on the row, so a migrated install can still read it. */
  readonly backend: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /**
   * Stream an object rather than materialising it (AF-M10-22).
   *
   * `get` is fine for a PDF and wrong for a video: a 200 MB upload buffered
   * whole is 200 MB of worker heap, and several concurrent ones is an OOM.
   * The social publishing nodes hand this straight to `fetch`, so the bytes go
   * store → socket without ever being fully resident.
   */
  getStream(key: string): Promise<ReadableStream<Uint8Array>>;
  /** Idempotent: deleting an absent key is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class BlobNotFoundError extends Error {
  constructor(key: string) {
    super(`Blob not found: ${key}`);
    this.name = "BlobNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Local filesystem
// ---------------------------------------------------------------------------

/**
 * Keys are `<org>/<yyyy-mm>/<id>`, so the org prefix is structural rather than
 * a convention a caller could forget. The month segment keeps directory
 * listings usable when an install accumulates a year of files.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/;

function assertSafeKey(key: string): void {
  // A key reaches the filesystem as a path. Anything that could climb out of
  // the root — `..`, an absolute path, a backslash on Windows — is refused
  // here rather than relied on to be impossible upstream.
  if (!KEY_PATTERN.test(key) || key.includes("..")) {
    throw new Error(`Blob store: unsafe object key "${key}"`);
  }
}

export class LocalBlobStore implements BlobStore {
  readonly backend = "local";

  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    assertSafeKey(key);
    const target = resolve(join(this.root, key));
    const root = resolve(this.root);
    // Belt and braces: even with a validated key, confirm the resolved path is
    // inside the root before writing to it.
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Blob store: object key escapes the store root`);
    }
    return target;
  }

  // `contentType` is part of the interface and unused here: a filesystem has
  // no place to record it. The row carries the MIME type, so nothing is lost.
  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BlobNotFoundError(key);
      }
      throw error;
    }
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    const path = this.pathFor(key);
    try {
      // stat first: createReadStream defers ENOENT to an async 'error' event,
      // which would surface as an unhandled rejection mid-upload rather than
      // as a BlobNotFoundError the caller can report.
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new BlobNotFoundError(key);
      }
      throw error;
    }
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// S3-compatible
// ---------------------------------------------------------------------------

/**
 * Any S3-compatible store — AWS S3, Cloudflare R2, MinIO, Backblaze B2.
 *
 * The SDK is imported lazily so an install running on the local backend never
 * loads it, and so a missing dependency cannot break a dev boot. The types stay
 * inside this class: everything above the `BlobStore` interface deals in
 * `Buffer` and strings.
 */
export class S3BlobStore implements BlobStore {
  readonly backend = "s3";

  constructor(
    private readonly config: {
      bucket: string;
      region: string;
      endpoint?: string;
      accessKeyId: string;
      secretAccessKey: string;
      /** R2 and MinIO need path-style addressing; AWS does not. */
      forcePathStyle?: boolean;
    },
  ) {}

  private clientPromise?: Promise<import("@aws-sdk/client-s3").S3Client>;

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          region: this.config.region,
          endpoint: this.config.endpoint,
          forcePathStyle: this.config.forcePathStyle,
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
        });
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        // Content hash is verified by the caller against the row's sha256;
        // this is the transport-level check that the upload arrived intact.
        ChecksumSHA256: createHash("sha256").update(data).digest("base64"),
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { GetObjectCommand, NoSuchKey } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes) {
        throw new BlobNotFoundError(key);
      }
      return Buffer.from(bytes);
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new BlobNotFoundError(key);
      }
      throw error;
    }
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array>> {
    assertSafeKey(key);
    const { GetObjectCommand, NoSuchKey } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const response = await client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      // `transformToWebStream` is the whole point: the alternative,
      // `transformToByteArray`, is exactly the buffering this exists to avoid.
      const body = response.Body;
      if (!body) {
        throw new BlobNotFoundError(key);
      }
      return body.transformToWebStream() as ReadableStream<Uint8Array>;
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new BlobNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    // S3 delete is already idempotent — an absent key returns 204.
    await client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

let cached: BlobStore | undefined;

/**
 * The process-wide store, chosen from env.
 *
 * S3 when `BLOB_S3_BUCKET` and its credentials are set; the local filesystem
 * otherwise, under `BLOB_LOCAL_ROOT` (default `.blobstore`).
 *
 * Selection is **by configuration present, not by NODE_ENV**. A production
 * deployment that forgets the bucket would otherwise silently write to a
 * container filesystem that vanishes on the next deploy, and nobody finds out
 * until a user opens a run from yesterday.
 */
export function resolveBlobStore(): BlobStore {
  if (cached) {
    return cached;
  }

  const bucket = process.env.BLOB_S3_BUCKET;
  const accessKeyId = process.env.BLOB_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BLOB_S3_SECRET_ACCESS_KEY;

  if (bucket && accessKeyId && secretAccessKey) {
    cached = new S3BlobStore({
      bucket,
      region: process.env.BLOB_S3_REGION ?? "auto",
      endpoint: process.env.BLOB_S3_ENDPOINT || undefined,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.BLOB_S3_FORCE_PATH_STYLE === "true",
    });
    return cached;
  }

  if (process.env.NODE_ENV === "production" && bucket) {
    // Half-configured is the dangerous state: a bucket name with no
    // credentials reads as "they meant to use S3" and falling back would put
    // production files on ephemeral disk.
    throw new Error(
      "BLOB_S3_BUCKET is set but BLOB_S3_ACCESS_KEY_ID / BLOB_S3_SECRET_ACCESS_KEY are not. " +
        "Refusing to fall back to local disk in production.",
    );
  }

  cached = new LocalBlobStore(process.env.BLOB_LOCAL_ROOT ?? ".blobstore");
  return cached;
}

/** Test seam: drop the memoized store so env changes take effect. */
export function resetBlobStore(): void {
  cached = undefined;
}
