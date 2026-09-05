import "server-only";
import { NonRetriableError } from "inngest";
import { readFileStream } from "@/features/files/server/file-service";

/**
 * Streaming media uploads (AF-M10-22).
 *
 * **A video is never buffered whole.** `readFile` returns a Buffer, which is
 * correct for a PDF and wrong for a 200 MB video: that is 200 MB of worker
 * heap, and a handful of concurrent uploads is an OOM that takes the whole
 * worker with it — including every unrelated run on it.
 *
 * So these read through `readFileStream`, and the stream goes straight into
 * `fetch`'s body. The bytes travel store → socket and the peak memory is a
 * chunk, not a file.
 *
 * Two consequences the callers have to live with, and which are the reason
 * this is a shared module rather than three copies:
 *
 *  - **`duplex: "half"` is required.** Passing a stream as a request body
 *    without it throws in Node's fetch, with a message that does not mention
 *    streaming at all.
 *  - **A streamed body cannot be retried by re-sending the same object.** A
 *    consumed stream is gone, so anything that retries has to re-open the
 *    file. That is why each upload call takes a `fileId` rather than a stream.
 */

export interface StreamedUpload {
  url: string;
  method?: "POST" | "PUT";
  headers: Record<string, string>;
  fileId: string;
  organizationId: string;
  where: string;
  /** Refuse before opening the file. Named limits beat provider rejections. */
  maxBytes?: number;
}

export interface StreamedUploadResult {
  status: number;
  headers: Headers;
  text: string;
  bytesSent: number;
  filename: string;
  mimeType: string;
}

/**
 * PUT/POST a stored file's bytes without materialising them.
 *
 * Returns the raw response rather than parsing it: the four providers here
 * disagree about whether an upload answers with JSON, an empty 201, or a
 * header, so interpretation belongs to the caller.
 */
export async function uploadStoredFile(
  args: StreamedUpload,
): Promise<StreamedUploadResult> {
  const { stream, filename, mimeType, size } = await readFileStream({
    fileId: args.fileId,
    organizationId: args.organizationId,
  });

  if (args.maxBytes && size > args.maxBytes) {
    // Checked here rather than after the upload fails: sending 2 GB to learn
    // the limit is 1 GB costs the user's bandwidth and the provider's patience.
    throw new NonRetriableError(
      `${args.where}: "${filename}" is ${formatBytes(size)}, over this platform's ${formatBytes(args.maxBytes)} limit.`,
    );
  }

  const response = await fetch(args.url, {
    method: args.method ?? "POST",
    headers: {
      ...args.headers,
      "Content-Type": args.headers["Content-Type"] ?? mimeType,
      // Providers that stream still want the length up front, and a chunked
      // body without it is rejected by several of them.
      "Content-Length": String(size),
    },
    body: stream,
    // Required by Node's fetch for a streaming body. Without it the call
    // throws, and the message says nothing about streams.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
    bytesSent: size,
    filename,
    mimeType,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Pull the single file reference a media node was given.
 *
 * Shared because all four nodes need the same three refusals, and because the
 * "two braces instead of three" mistake is the most common authoring error by
 * a wide margin — two braces HTML-escape the quotes and the JSON never parses.
 */
export function parseSingleFileRef(args: {
  rendered: string;
  where: string;
  collect: (value: unknown) => Array<{ $file: { id: string } }>;
}): string {
  const trimmed = args.rendered.trim();

  if (trimmed.length === 0) {
    throw new NonRetriableError(
      `${args.where}: the file expression resolved to nothing.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new NonRetriableError(
      `${args.where}: the file expression did not resolve to a file reference. Use three braces — {{{json render.file}}} — rather than two, which HTML-escapes the quotes.`,
    );
  }

  const refs = args.collect(parsed);
  if (refs.length === 0) {
    throw new NonRetriableError(
      `${args.where}: the file expression resolved to a value containing no file reference.`,
    );
  }
  if (refs.length > 1) {
    throw new NonRetriableError(
      `${args.where}: the file expression resolved to ${refs.length} files. This node publishes one — put it inside a Split Out segment to publish several.`,
    );
  }

  return refs[0].$file.id;
}
