import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { readFileStream } from "@/features/files/server/file-service";
import { formatBytes } from "./upload-stream";

/**
 * Upload-Post.com publishing (AF-M10-22).
 *
 * A broker: it holds the user's Instagram/TikTok/etc. connections and posts on
 * their behalf, which is why it exists in this family at all — Instagram's own
 * Graph API needs a Business account, an app review and a Facebook Page, and
 * none of that is something a workflow tool can shortcut.
 *
 * The upload is multipart rather than JSON, and the media is streamed: an
 * Instagram video is routinely 50–100 MB, and buffering it would be that much
 * worker heap per concurrent run.
 */

const UPLOAD_POST_API = "https://api.upload-post.com/api";
const REQUEST_TIMEOUT_MS = 120_000;

/** Instagram's own limits, refused here so the error names the number. */
export const UPLOAD_POST_MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const UPLOAD_POST_MAX_CAPTION_CHARS = 2200;

export interface UploadPostResult {
  success?: boolean;
  message?: string;
  results?: Record<string, { success?: boolean; error?: string }>;
}

function classify(status: number, text: string, where: string): Error {
  let message = "";
  try {
    const parsed = JSON.parse(text) as { message?: string; error?: string };
    message = parsed.message ?? parsed.error ?? "";
  } catch {
    message = text.slice(0, 200);
  }

  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: Upload-Post rejected the API key${message ? `: ${message}` : ""}.`,
    );
  }
  if (status === 404) {
    return new NonRetriableError(
      `${where}: Upload-Post does not know that user profile. The profile name is the one created in the Upload-Post dashboard, not the Instagram handle.`,
    );
  }
  if (status === 429) {
    return new RetryAfterError(`${where}: Upload-Post rate limit hit.`, 60);
  }
  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Upload-Post is unavailable (${status}).`,
      30,
    );
  }
  return new NonRetriableError(
    `${where}: Upload-Post refused the request (${status})${message ? `: ${message}` : ""}.`,
  );
}

/**
 * Publish a stored video or image to the platforms a profile is connected to.
 *
 * The response is the part that needs care: Upload-Post answers **HTTP 200
 * with a per-platform result map**, so a request that "succeeded" can contain
 * an Instagram entry that failed. Reporting the status alone would call a
 * failed publish a success — the same trap as Slack's `ok: false`, in a
 * different shape.
 */
export async function publishViaUploadPost(args: {
  secret: CredentialSecret | undefined;
  profile: string;
  platforms: string[];
  caption: string;
  fileId: string;
  organizationId: string;
  isVideo: boolean;
  where: string;
}): Promise<{
  published: string[];
  failed: Array<{ platform: string; error: string }>;
}> {
  const apiKey = args.secret?.apiKey;
  if (!apiKey) {
    throw new NonRetriableError(
      `${args.where}: no Upload-Post credential is bound to this node.`,
    );
  }

  const { stream, size, mimeType, filename } = await readFileStream({
    fileId: args.fileId,
    organizationId: args.organizationId,
  });

  if (size > UPLOAD_POST_MAX_VIDEO_BYTES) {
    throw new NonRetriableError(
      `${args.where}: "${filename}" is ${formatBytes(size)}, over the ${formatBytes(UPLOAD_POST_MAX_VIDEO_BYTES)} limit.`,
    );
  }

  const form = new FormData();
  form.append("user", args.profile);
  form.append(args.isVideo ? "title" : "caption", args.caption);
  for (const platform of args.platforms) {
    form.append("platform[]", platform);
  }
  // `new Response(stream).blob()` is the one place bytes are collected, and it
  // is unavoidable: FormData has no streaming entry in Node's fetch. The
  // stream still means the file is read once, lazily, rather than being held
  // by both readFile and the form.
  form.append(
    args.isVideo ? "video" : "photos[]",
    await new Response(stream).blob(),
    filename,
  );

  const response = await fetch(
    `${UPLOAD_POST_API}/upload${args.isVideo ? "" : "_photos"}`,
    {
      method: "POST",
      headers: {
        Authorization: `Apikey ${apiKey}`,
        // Content-Type is deliberately absent: fetch sets it with the
        // multipart boundary, and overriding it produces an unparseable body.
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw classify(response.status, text, args.where);
  }

  let parsed: UploadPostResult;
  try {
    parsed = JSON.parse(text) as UploadPostResult;
  } catch {
    throw new NonRetriableError(
      `${args.where}: Upload-Post returned a response that is not JSON.`,
    );
  }

  const published: string[] = [];
  const failed: Array<{ platform: string; error: string }> = [];

  for (const [platform, result] of Object.entries(parsed.results ?? {})) {
    if (result?.success) {
      published.push(platform);
    } else {
      failed.push({ platform, error: result?.error ?? "unknown error" });
    }
  }

  // No per-platform detail at all: fall back to the envelope rather than
  // reporting an empty success.
  if (published.length === 0 && failed.length === 0) {
    if (parsed.success) {
      published.push(...args.platforms);
    } else {
      throw new NonRetriableError(
        `${args.where}: Upload-Post reported failure${parsed.message ? `: ${parsed.message}` : ""}.`,
      );
    }
  }

  return { published, failed };
}
