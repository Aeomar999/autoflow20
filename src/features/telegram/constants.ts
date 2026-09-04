/**
 * Telegram vocabulary shared by node definitions (AF-M10-21).
 *
 * **Client-safe by construction** — `definition.ts` files import this, and
 * definitions are bundled into the editor. No value import from a server-only
 * package may appear here (`src/nodes/client-boundary.test.ts` enforces it).
 */

export const TELEGRAM_CREDENTIAL_TYPE = "telegram.botToken";

export const TELEGRAM_LOGO = "/logos/telegram.svg";

/**
 * Telegram's own cap on a text message. Longer text is rejected outright, so
 * the node splits rather than losing the tail.
 */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

/** Parse modes Telegram accepts. `null` sends plain text. */
export const TELEGRAM_PARSE_MODES = ["MarkdownV2", "HTML", "plain"] as const;

export type TelegramParseMode = (typeof TELEGRAM_PARSE_MODES)[number];

/**
 * Bot API download limit. Files above this cannot be fetched through
 * `getFile` at all — the API answers with an error rather than a link.
 */
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
