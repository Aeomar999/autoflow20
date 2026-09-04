import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { TELEGRAM_MAX_DOWNLOAD_BYTES } from "../constants";

/**
 * The Telegram Bot API client (AF-M10-21).
 *
 * The API's shape is unusual in two ways that matter:
 *
 * 1. **The bot token is in the URL path**, not a header. That means it lands
 *    in any log line that records a URL, so nothing here logs a request URL,
 *    and error messages quote Telegram's `description` rather than the path.
 * 2. **Failure is an `ok: false` envelope**, like Slack — an HTTP 200 can
 *    describe a refusal. `parameters.retry_after` on a 429 is the wait in
 *    seconds, and Telegram means it: ignoring it is how a bot gets throttled
 *    harder.
 */

const TELEGRAM_API = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 30_000;

export interface TelegramMessage {
  message_id: number;
  date?: number;
  chat?: { id: number; type?: string; title?: string; username?: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  /** Relative path under the download root. Absent for an oversized file. */
  file_path?: string;
}

interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

function classify<T>(
  status: number,
  body: TelegramEnvelope<T>,
  where: string,
): Error {
  const description = body.description ?? "";
  const code = body.error_code ?? status;

  if (code === 429) {
    // Telegram states the wait explicitly. Guessing a shorter one gets the bot
    // throttled harder.
    const retryAfter = body.parameters?.retry_after ?? 30;
    return new RetryAfterError(
      `${where}: Telegram rate limit hit.`,
      Math.min(retryAfter, 3600),
    );
  }

  if (code === 401) {
    return new NonRetriableError(
      `${where}: Telegram rejected the bot token. Reconnect the credential — retrying will not fix a revoked token.`,
    );
  }

  if (code === 403) {
    // The most common real cause by a distance, and Telegram's own wording
    // ("bot was blocked by the user") does not say what to do.
    return new NonRetriableError(
      `${where}: Telegram refused (${description || "forbidden"}). A bot cannot message someone who has not started a chat with it, or who has blocked it — and it must be a member of a group to post there.`,
    );
  }

  if (code === 400) {
    return new NonRetriableError(
      `${where}: Telegram rejected the request${description ? `: ${description}` : ""}.`,
    );
  }

  if (status >= 500) {
    return new RetryAfterError(
      `${where}: Telegram is unavailable (${status}).`,
      15,
    );
  }

  return new NonRetriableError(
    `${where}: Telegram request failed (${code})${description ? `: ${description}` : ""}.`,
  );
}

/** One Bot API call. */
export async function telegramFetch<T>(
  secret: CredentialSecret | undefined,
  request: { method: string; body?: unknown; where: string },
): Promise<T> {
  const botToken = secret?.botToken;
  if (!botToken) {
    throw new NonRetriableError(
      `${request.where}: no Telegram credential is bound to this node. Connect a Telegram bot token.`,
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}/bot${botToken}/${request.method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body ?? {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const payload = (await response
    .json()
    .catch(() => ({}))) as TelegramEnvelope<T>;

  // Like Slack: an HTTP 200 can describe a refusal, so the envelope decides.
  if (!response.ok || payload.ok !== true) {
    throw classify(response.status, payload, request.where);
  }

  return payload.result as T;
}

/**
 * Split text at Telegram's message limit.
 *
 * Telegram rejects an over-long message outright rather than truncating, so
 * the alternative to splitting is losing the whole message. Splitting on a
 * line boundary where possible keeps a digest readable instead of cutting a
 * sentence at character 4096.
 */
export function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const breakAt = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
    );
    // Only break on a boundary in the last quarter — otherwise a long
    // paragraph with one early newline would produce a tiny chunk.
    const cut = breakAt > limit * 0.75 ? breakAt + 1 : limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }

  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/**
 * Resolve a `file_id` to a download and fetch the bytes.
 *
 * Two calls, because that is how the API works: `getFile` returns a path valid
 * for about an hour, and the bytes come from a different host. Files over 20 MB
 * cannot be fetched through the Bot API at all — `getFile` answers with an
 * error rather than a path — so that limit is checked before the download
 * rather than surfacing as a confusing 400.
 */
export async function downloadTelegramFile(args: {
  secret: CredentialSecret | undefined;
  fileId: string;
  where: string;
}): Promise<{
  data: Buffer;
  filename: string;
  mimeType: string;
  size: number;
}> {
  const botToken = args.secret?.botToken;
  if (!botToken) {
    throw new NonRetriableError(
      `${args.where}: no Telegram credential is bound to this node.`,
    );
  }

  const file = await telegramFetch<TelegramFile>(args.secret, {
    method: "getFile",
    body: { file_id: args.fileId },
    where: args.where,
  });

  if (!file.file_path) {
    throw new NonRetriableError(
      `${args.where}: Telegram returned no download path for that file. Files over 20 MB cannot be fetched through the Bot API.`,
    );
  }

  if (file.file_size && file.file_size > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    throw new NonRetriableError(
      `${args.where}: that file is ${Math.round(file.file_size / 1024 / 1024)} MB, over the Bot API's 20 MB download limit.`,
    );
  }

  const response = await fetch(
    `${TELEGRAM_API}/file/bot${botToken}/${file.file_path}`,
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  );

  if (!response.ok) {
    // A path expires after roughly an hour. Retrying the whole step re-runs
    // getFile and gets a fresh one, so this is worth retrying.
    throw new RetryAfterError(
      `${args.where}: could not download the file (HTTP ${response.status}). Telegram download links expire after about an hour.`,
      10,
    );
  }

  const data = Buffer.from(await response.arrayBuffer());

  if (data.byteLength > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    throw new NonRetriableError(
      `${args.where}: the downloaded file is larger than the Bot API's 20 MB limit.`,
    );
  }

  return {
    data,
    // The stored name is the last path segment; Telegram does not send the
    // original filename with getFile.
    filename: file.file_path.split("/").pop() ?? `telegram-${file.file_id}`,
    mimeType:
      response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
    size: data.byteLength,
  };
}
