import "server-only";
import { createHash } from "node:crypto";
import { NonRetriableError } from "inngest";
import {
  assertSafeEndpoint,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";
import prisma from "@/lib/db";
import { type FileRef, formatFileSize, makeFileRef } from "../file-ref";
import { type BlobStore, resolveBlobStore } from "./blob-store";

/**
 * Storing and reading run files (AF-M10-06, ADR-0025).
 *
 * Everything that decides *whether* bytes may be written or read lives here —
 * the per-file ceiling, the per-org quota, and the tenant check. The blob
 * store below it only moves bytes and has no idea who is asking.
 */

/** Per-file ceiling. A video render is the largest thing the library moves. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Bytes one org may hold at once. Enforced before a write, so the overshoot is
 * bounded by one file rather than by however many run concurrently.
 */
export const DEFAULT_ORG_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * How long a file with no execution lives.
 *
 * A form upload arrives before the run exists, so it has no execution to
 * inherit a lifetime from. Two days is long enough for a run to be retried and
 * short enough that abandoned uploads do not accumulate.
 */
export const ORPHAN_FILE_TTL_MS = 48 * 60 * 60 * 1000;

export class FileQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileQuotaExceededError";
  }
}

export class FileAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileAccessDeniedError";
  }
}

export interface StoreFileArgs {
  organizationId: string;
  executionId?: string | null;
  workflowId?: string | null;
  filename: string;
  mimeType: string;
  data: Buffer;
  /** Overrides the org default; used by tests and, later, by plan limits. */
  quotaBytes?: number;
  store?: BlobStore;
  now?: Date;
}

/** `<org>/<yyyy-mm>/<random>` — the org prefix is structural, not a convention. */
function objectKey(organizationId: string, id: string, now: Date): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${organizationId}/${month}/${id}`;
}

/**
 * Strip anything that is not a filename.
 *
 * The name comes from a Content-Disposition header, a form field, or a
 * provider's metadata — all attacker-influenced. It is only ever displayed and
 * used as a download name, never as a path, but a name containing a separator
 * would still be wrong everywhere it is shown.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "file";
  // Char-code scan rather than a control-character regex, matching
  // `config-fields.ts` — the ban is intentional, and Biome's
  // noControlCharactersInRegex rule exists to catch the accidental kind.
  let cleaned = "";
  for (const char of base) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      cleaned += char;
    }
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : "file";
}

/** Bytes this org currently holds. */
export async function organizationStorageBytes(
  organizationId: string,
): Promise<number> {
  const result = await prisma.storedFile.aggregate({
    where: { organizationId },
    _sum: { size: true },
  });
  return result._sum.size ?? 0;
}

/**
 * Persist bytes and return the reference that travels between nodes.
 *
 * The row is written *after* the object, so a crash between the two leaves an
 * orphaned object the sweep can find by key prefix — whereas the other order
 * leaves a row pointing at nothing, which every reader would treat as data
 * loss.
 */
export async function storeFile(args: StoreFileArgs): Promise<FileRef> {
  const {
    organizationId,
    data,
    quotaBytes = DEFAULT_ORG_STORAGE_QUOTA_BYTES,
  } = args;
  const now = args.now ?? new Date();
  const store = args.store ?? resolveBlobStore();

  if (data.byteLength === 0) {
    throw new NonRetriableError(
      "File store: refusing to store an empty file — an empty result is almost always a failed fetch reported as success.",
    );
  }

  if (data.byteLength > MAX_FILE_BYTES) {
    throw new NonRetriableError(
      `File store: ${formatFileSize(data.byteLength)} exceeds the ${formatFileSize(MAX_FILE_BYTES)} per-file limit.`,
    );
  }

  const used = await organizationStorageBytes(organizationId);
  if (used + data.byteLength > quotaBytes) {
    throw new FileQuotaExceededError(
      `File store: this workspace holds ${formatFileSize(used)} of its ${formatFileSize(quotaBytes)} storage quota; ` +
        `storing ${formatFileSize(data.byteLength)} would exceed it. Delete old runs or raise the quota.`,
    );
  }

  const sha256 = createHash("sha256").update(data).digest("hex");
  const filename = sanitizeFilename(args.filename);
  const id = createHash("sha256")
    .update(`${organizationId}:${sha256}:${now.getTime()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 24);
  const key = objectKey(organizationId, id, now);

  await store.put(key, data, args.mimeType);

  const row = await prisma.storedFile.create({
    data: {
      organizationId,
      executionId: args.executionId ?? null,
      workflowId: args.workflowId ?? null,
      filename,
      mimeType: args.mimeType,
      size: data.byteLength,
      sha256,
      storageKey: key,
      backend: store.backend,
      // A file with no run has nothing to inherit a lifetime from, so it gets
      // an explicit one. A file with a run is deleted with that run.
      expiresAt: args.executionId
        ? null
        : new Date(now.getTime() + ORPHAN_FILE_TTL_MS),
    },
  });

  return makeFileRef({
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
  });
}

/**
 * Read the bytes behind a `FileRef`.
 *
 * **The org is required, not optional.** A `FileRef` is a plain object that
 * travels in a run context, and a context can be built from a template, a
 * `CODE` node's return value, or a webhook body — all of which a tenant
 * controls. Trusting the id alone would make "read any file in the system" a
 * two-line CODE node.
 */
export async function readFile(args: {
  fileId: string;
  organizationId: string;
  store?: BlobStore;
}): Promise<{ data: Buffer; filename: string; mimeType: string }> {
  const row = await prisma.storedFile.findUnique({
    where: { id: args.fileId },
  });

  if (!row || row.organizationId !== args.organizationId) {
    // One message for "does not exist" and "belongs to someone else": telling
    // them apart turns this into an existence oracle for other tenants' files.
    throw new FileAccessDeniedError(
      `File ${args.fileId} is not available to this workspace.`,
    );
  }

  const store = args.store ?? resolveBlobStore();
  const data = await store.get(row.storageKey);

  return { data, filename: row.filename, mimeType: row.mimeType };
}

/**
 * Read a stored file as a STREAM (AF-M10-22).
 *
 * Same tenant check as `readFile` — the check is the point, and a streaming
 * variant that skipped it would be a hole in exactly the place that matters.
 * What differs is that the bytes are never fully resident: the social
 * publishing nodes hand this straight to `fetch`, so a 200 MB video costs a
 * buffer, not 200 MB of worker heap.
 *
 * The metadata comes back alongside the stream because every caller needs the
 * size and MIME type for the upload's own headers, and fetching the row twice
 * would be two queries for one answer.
 */
export async function readFileStream(args: {
  fileId: string;
  organizationId: string;
  store?: BlobStore;
}): Promise<{
  stream: ReadableStream<Uint8Array>;
  filename: string;
  mimeType: string;
  size: number;
}> {
  const row = await prisma.storedFile.findUnique({
    where: { id: args.fileId },
  });

  if (!row || row.organizationId !== args.organizationId) {
    // One message for "does not exist" and "belongs to someone else", as in
    // readFile: telling them apart is an existence oracle for other tenants.
    throw new FileAccessDeniedError(
      `File ${args.fileId} is not available to this workspace.`,
    );
  }

  const store = args.store ?? resolveBlobStore();

  return {
    stream: await store.getStream(row.storageKey),
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
  };
}

/** Metadata without the bytes — for a node that only needs to check a size. */
export async function statFile(args: {
  fileId: string;
  organizationId: string;
}): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}> {
  const row = await prisma.storedFile.findUnique({
    where: { id: args.fileId },
  });
  if (!row || row.organizationId !== args.organizationId) {
    throw new FileAccessDeniedError(
      `File ${args.fileId} is not available to this workspace.`,
    );
  }
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
  };
}

/**
 * Fetch a URL into the blob store (`FILE_DOWNLOAD`'s engine).
 *
 * Goes through the same egress guard as every other outbound request: the
 * host is vetted, the socket is pinned to the address that was vetted, and
 * redirects are re-vetted per hop (ADR-0015, ADR-0017). A download URL is
 * frequently a template resolving to something a third party supplied, so this
 * is not a formality.
 *
 * The size cap is enforced **while reading**, not after: a caller that
 * downloads 4 GB and then checks the length has already spent the memory.
 */
export async function downloadToFile(args: {
  url: string;
  organizationId: string;
  executionId?: string | null;
  workflowId?: string | null;
  filename?: string;
  headers?: Record<string, string>;
  maxBytes?: number;
  store?: BlobStore;
  quotaBytes?: number;
}): Promise<FileRef> {
  const maxBytes = Math.min(args.maxBytes ?? MAX_FILE_BYTES, MAX_FILE_BYTES);
  const url = await assertSafeEndpoint(args.url);

  const response = await safeFetch(url, {
    headers: args.headers,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new NonRetriableError(
      `File download: ${url.origin}${url.pathname} returned ${response.status} ${response.statusText}`,
    );
  }

  // Trust the header only as an early exit; the real check is the read loop,
  // because Content-Length is advisory and often absent or wrong.
  const declared = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new NonRetriableError(
      `File download: response declares ${formatFileSize(declared)}, over the ${formatFileSize(maxBytes)} limit.`,
    );
  }

  const data = await readCapped(response, maxBytes);

  return storeFile({
    organizationId: args.organizationId,
    executionId: args.executionId,
    workflowId: args.workflowId,
    filename:
      args.filename ??
      filenameFromResponse(response, url.pathname) ??
      "download",
    mimeType:
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "application/octet-stream",
    data,
    store: args.store,
    quotaBytes: args.quotaBytes,
  });
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.alloc(0);
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      void reader.cancel();
      throw new NonRetriableError(
        `File download: response exceeded the ${formatFileSize(maxBytes)} limit.`,
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** `attachment; filename="invoice.pdf"` → `invoice.pdf`, else the URL's last segment. */
function filenameFromResponse(
  response: Response,
  pathname: string,
): string | undefined {
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
    if (star?.[1]) {
      try {
        return sanitizeFilename(decodeURIComponent(star[1].trim()));
      } catch {
        // A malformed RFC 5987 value falls through to the plain form below.
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    if (plain?.[1]) {
      return sanitizeFilename(plain[1]);
    }
  }
  const last = pathname.split("/").filter(Boolean).pop();
  return last ? sanitizeFilename(decodeURIComponent(last)) : undefined;
}

/**
 * Delete the objects behind a set of files, then their rows.
 *
 * Object first: a row that outlives its object is a broken reference the user
 * sees; an object that outlives its row is storage the next sweep can still
 * find by key. The cheaper failure is the one we choose.
 */
export async function deleteFiles(
  fileIds: string[],
  store: BlobStore = resolveBlobStore(),
): Promise<number> {
  if (fileIds.length === 0) {
    return 0;
  }
  const rows = await prisma.storedFile.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, storageKey: true },
  });

  const deleted: string[] = [];
  for (const row of rows) {
    try {
      await store.delete(row.storageKey);
      deleted.push(row.id);
    } catch {
      // Leave the row: the next sweep retries. Deleting it here would forget a
      // file that is still occupying storage.
    }
  }

  if (deleted.length > 0) {
    await prisma.storedFile.deleteMany({ where: { id: { in: deleted } } });
  }
  return deleted.length;
}
