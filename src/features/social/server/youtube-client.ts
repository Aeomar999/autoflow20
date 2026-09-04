import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { readFileStream } from "@/features/files/server/file-service";
import { formatBytes } from "./upload-stream";

/**
 * YouTube resumable upload (AF-M10-22).
 *
 * Resumable rather than simple upload, for a reason that is not about
 * resuming: the simple endpoint takes the whole file as one request body and
 * caps at 5 MB, which no real video is. The resumable flow is two steps —
 * announce the metadata and get a session URL, then send the bytes to that URL
 * — and the second step is where the stream goes.
 *
 * The session URL is the interesting part for retries: it is valid for a week,
 * and re-PUTting to it resumes rather than duplicating. That is what makes a
 * failed upload safe to retry without creating a second video.
 */

const YOUTUBE_UPLOAD_API =
  "https://www.googleapis.com/upload/youtube/v3/videos";

/** YouTube's ceiling. Anything larger is refused by the API itself. */
export const YOUTUBE_MAX_VIDEO_BYTES = 256 * 1024 * 1024 * 1024;

/**
 * A backstop, not the binding limit.
 *
 * `MAX_FILE_BYTES` in the file service caps a stored file at 100 MB, so that
 * is what a workflow actually hits — this exists so the node still refuses
 * sensibly if that ceiling is ever raised, rather than inheriting YouTube's
 * 256 GB by default.
 */
export const YOUTUBE_NODE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

export interface YouTubeVideo {
  id?: string;
  snippet?: { title?: string; description?: string };
  status?: { privacyStatus?: string; uploadStatus?: string };
}

function classify(status: number, text: string, where: string): Error {
  let reason = "";
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.message ?? "";
  } catch {
    reason = text.slice(0, 200);
  }

  if (status === 401) {
    return new NonRetriableError(
      `${where}: Google rejected the credential. Reconnect the YouTube credential.`,
    );
  }

  if (status === 403) {
    // The two real causes, neither of which a scope grant fixes.
    if (reason.includes("quota") || reason.includes("Limit")) {
      return new NonRetriableError(
        `${where}: the project's YouTube upload quota is exhausted (${reason}). An unverified Google Cloud project gets a handful of uploads a day; the cap is lifted by Google's API audit, not by retrying.`,
      );
    }
    return new NonRetriableError(
      `${where}: YouTube refused the upload (${reason || "forbidden"}). Check the channel is linked to the connected Google account and that the account is not restricted from uploading.`,
    );
  }

  if (status === 429) {
    return new RetryAfterError(`${where}: YouTube rate limit hit.`, 60);
  }

  if (status >= 500) {
    // Retrying re-uses the session URL, so this resumes rather than
    // re-uploading from zero.
    return new RetryAfterError(
      `${where}: YouTube is unavailable (${status}).`,
      30,
    );
  }

  return new NonRetriableError(
    `${where}: YouTube refused the request (${status})${reason ? `: ${reason}` : ""}.`,
  );
}

/**
 * Step one: announce the video and obtain a session URL.
 *
 * The metadata goes here, not with the bytes — sending both together is the
 * multipart flow, which has its own size limits and no resume.
 */
export async function startYouTubeUpload(args: {
  secret: CredentialSecret | undefined;
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "private" | "unlisted" | "public";
  contentLength: number;
  mimeType: string;
  where: string;
}): Promise<string> {
  const accessToken = args.secret?.accessToken;
  if (!accessToken) {
    throw new NonRetriableError(
      `${args.where}: no YouTube credential is bound to this node. Connect a YouTube credential.`,
    );
  }

  const response = await fetch(
    `${YOUTUBE_UPLOAD_API}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        // Both are required by the resumable protocol; without them Google
        // answers 400 with a message about the upload request, not the headers.
        "X-Upload-Content-Length": String(args.contentLength),
        "X-Upload-Content-Type": args.mimeType,
      },
      body: JSON.stringify({
        snippet: {
          title: args.title,
          description: args.description,
          ...(args.tags.length > 0 ? { tags: args.tags } : {}),
        },
        status: {
          privacyStatus: args.privacyStatus,
          // Required since 2021 for uploads by an API client; omitting it is a
          // 400 that names no field.
          selfDeclaredMadeForKids: false,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw classify(response.status, await response.text(), args.where);
  }

  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) {
    throw new NonRetriableError(
      `${args.where}: YouTube accepted the metadata but returned no upload session.`,
    );
  }
  return sessionUrl;
}

/**
 * Step two: send the bytes to the session URL, streamed.
 *
 * This is the part the acceptance is about. The file is read as a stream and
 * handed to `fetch`, so a 2 GB video costs a chunk of heap rather than 2 GB.
 */
export async function uploadYouTubeBytes(args: {
  sessionUrl: string;
  fileId: string;
  organizationId: string;
  where: string;
}): Promise<YouTubeVideo> {
  const { stream, size, mimeType, filename } = await readFileStream({
    fileId: args.fileId,
    organizationId: args.organizationId,
  });

  if (size > YOUTUBE_NODE_MAX_BYTES) {
    throw new NonRetriableError(
      `${args.where}: "${filename}" is ${formatBytes(size)}, over this node's ${formatBytes(YOUTUBE_NODE_MAX_BYTES)} limit.`,
    );
  }

  const response = await fetch(args.sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(size),
    },
    body: stream,
    // Required by Node's fetch for a streaming body.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  const text = await response.text();

  if (!response.ok) {
    throw classify(response.status, text, args.where);
  }

  try {
    return JSON.parse(text) as YouTubeVideo;
  } catch {
    throw new NonRetriableError(
      `${args.where}: YouTube accepted the upload but returned an unreadable response.`,
    );
  }
}
