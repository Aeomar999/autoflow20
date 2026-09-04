import "server-only";
import { secureCompare } from "@/lib/secure-compare";

/**
 * Telegram webhook verification and update shaping (AF-M10-21).
 *
 * **Telegram does not sign its webhooks.** There is no HMAC to check, so the
 * only proof a delivery is genuine is a shared secret — and Telegram offers
 * exactly one place to put it: the `secret_token` supplied to `setWebhook`,
 * which it echoes in `X-Telegram-Bot-Api-Secret-Token`.
 *
 * That makes this route's verification weaker than GitHub's or Intuit's by
 * construction, and worth being explicit about: anyone who learns the secret
 * can forge updates. So the secret lives per workflow (never a deployment-wide
 * one), the comparison is constant-time, and a delivery that fails it is
 * dropped without starting a run.
 */

/** Telegram's cap is 64 characters of `A-Z a-z 0-9 _ -`. */
export const TELEGRAM_SECRET_MIN_LENGTH = 16;

export function verifyTelegramSecret(args: {
  provided: string | null;
  expected: string;
}): boolean {
  if (!args.provided || !args.expected) return false;

  // A short secret is a configuration error, not a delivery to accept. Telegram
  // allows one character; that is not a secret, and letting it through would
  // make the header a formality.
  if (args.expected.length < TELEGRAM_SECRET_MIN_LENGTH) return false;

  return secureCompare(args.provided, args.expected);
}

export interface TelegramInbound {
  updateId: number;
  /** "message", "edited_message", "callback_query", … */
  kind: string;
  chatId: number | null;
  text: string;
  from: {
    id: number | null;
    username: string | null;
    firstName: string | null;
  };
  /** Present when the message carries a document, photo or voice note. */
  fileId: string | null;
  fileName: string | null;
}

/**
 * Pull the routing fields out of a Telegram update.
 *
 * An update carries exactly one of a dozen optional keys, so the shape is
 * decided by which key is present rather than by a discriminator field. A
 * photo is an *array* of sizes ascending, and the last is the largest — taking
 * the first would silently fetch a thumbnail.
 */
export function parseTelegramUpdate(body: unknown): TelegramInbound | null {
  if (!body || typeof body !== "object") return null;

  const update = body as Record<string, unknown>;
  const updateId = update.update_id;
  if (typeof updateId !== "number") return null;

  const kinds = [
    "message",
    "edited_message",
    "channel_post",
    "callback_query",
  ] as const;

  const kind = kinds.find((key) => update[key] !== undefined);
  if (!kind) {
    // A valid update this product does not handle — a poll answer, a chat
    // member change. Reported as "no message" rather than an error.
    return {
      updateId,
      kind: "unsupported",
      chatId: null,
      text: "",
      from: { id: null, username: null, firstName: null },
      fileId: null,
      fileName: null,
    };
  }

  const payload = (update[kind] ?? {}) as Record<string, unknown>;
  const message =
    kind === "callback_query"
      ? ((payload.message ?? {}) as Record<string, unknown>)
      : payload;

  const chat = (message.chat ?? {}) as { id?: unknown };
  const from = (payload.from ?? {}) as Record<string, unknown>;

  const document = message.document as
    | { file_id?: string; file_name?: string }
    | undefined;
  // Ascending by size; the last entry is the full-resolution image.
  const photos = Array.isArray(message.photo)
    ? (message.photo as Array<{ file_id?: string }>)
    : [];
  const voice = message.voice as { file_id?: string } | undefined;

  return {
    updateId,
    kind,
    chatId: typeof chat.id === "number" ? chat.id : null,
    text:
      typeof message.text === "string"
        ? message.text
        : typeof payload.data === "string"
          ? payload.data
          : typeof message.caption === "string"
            ? message.caption
            : "",
    from: {
      id: typeof from.id === "number" ? from.id : null,
      username: typeof from.username === "string" ? from.username : null,
      firstName: typeof from.first_name === "string" ? from.first_name : null,
    },
    fileId:
      document?.file_id ??
      photos[photos.length - 1]?.file_id ??
      voice?.file_id ??
      null,
    fileName: document?.file_name ?? null,
  };
}
