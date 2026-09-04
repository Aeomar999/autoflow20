import "server-only";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { googleFetch, paginate } from "./google-client";

/**
 * Gmail operations (AF-M10-15).
 *
 * Two shapes the library needs: send a message (with attachments that came
 * from the blob store), and find new mail matching a query.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Attachment bytes one message may carry. Gmail's own ceiling is 25 MB. */
export const MAX_GMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  /** Plain-text body where the message has one, else text from the HTML part. */
  body: string;
  labelIds: string[];
  /** Attachment metadata only — bytes are fetched on demand. */
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

/**
 * A MIME header value that is safe to emit.
 *
 * A newline in a subject or recipient is header injection: it ends the header
 * and starts another, so `subject = "Hi\nBcc: everyone@..."` adds a recipient.
 * These values are templated from run data, so this is not hypothetical.
 */
function headerValue(raw: string, field: string): string {
  const cleaned = raw.replace(/[\r\n]+/g, " ").trim();
  if (cleaned.length > 998) {
    throw new NonRetriableError(
      `Gmail: the ${field} header is longer than the 998 characters RFC 5322 allows.`,
    );
  }
  return cleaned;
}

/**
 * RFC 2047 encoding for a header that may contain non-ASCII.
 *
 * A subject with an em dash or an accented name is ordinary; sending it raw
 * produces mojibake in most clients.
 */
function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

/**
 * Build an RFC 2822 message, base64url-encoded as Gmail's `raw` field wants.
 *
 * Multipart only when there are attachments: a plain HTML mail is a simpler
 * message and renders more predictably in old clients.
 */
export function buildRawMessage(args: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: GmailAttachment[];
  /** Set to reply within a thread. */
  inReplyTo?: string;
}): string {
  const attachments = args.attachments ?? [];
  const totalBytes = attachments.reduce((sum, a) => sum + a.data.byteLength, 0);
  if (totalBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
    throw new NonRetriableError(
      `Gmail: attachments total ${totalBytes} bytes, over the ${MAX_GMAIL_ATTACHMENT_BYTES}-byte limit for one message.`,
    );
  }

  const headers: string[] = [
    `From: ${headerValue(args.from, "From")}`,
    `To: ${headerValue(args.to, "To")}`,
  ];
  if (args.cc) headers.push(`Cc: ${headerValue(args.cc, "Cc")}`);
  if (args.bcc) headers.push(`Bcc: ${headerValue(args.bcc, "Bcc")}`);
  headers.push(
    `Subject: ${encodeHeader(headerValue(args.subject, "Subject"))}`,
  );
  if (args.inReplyTo) {
    headers.push(`In-Reply-To: ${headerValue(args.inReplyTo, "In-Reply-To")}`);
    headers.push(`References: ${headerValue(args.inReplyTo, "References")}`);
  }
  headers.push("MIME-Version: 1.0");

  const bodyHtml = args.html ?? "";
  const bodyText = args.text ?? "";
  const contentType = bodyHtml ? "text/html" : "text/plain";
  const content = bodyHtml || bodyText;

  let message: string;

  if (attachments.length === 0) {
    message = [
      ...headers,
      `Content-Type: ${contentType}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(content, "utf-8").toString("base64"),
    ].join("\r\n");
  } else {
    // Random enough that content cannot contain it by accident, which would
    // truncate the message at the collision.
    const boundary = `----autoflow_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2)}`;

    const parts: string[] = [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset="UTF-8"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(content, "utf-8").toString("base64"),
      "",
    ];

    for (const attachment of attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${attachment.mimeType}; name="${headerValue(attachment.filename, "attachment name")}"`,
        `Content-Disposition: attachment; filename="${headerValue(attachment.filename, "attachment name")}"`,
        "Content-Transfer-Encoding: base64",
        "",
        // Wrapped at 76 characters: unwrapped base64 exceeds the 998-character
        // line limit and some relays reject or mangle it.
        (attachment.data.toString("base64").match(/.{1,76}/g) ?? []).join(
          "\r\n",
        ),
        "",
      );
    }

    parts.push(`--${boundary}--`);

    message = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      ...parts,
    ].join("\r\n");
  }

  return Buffer.from(message, "utf-8").toString("base64url");
}

export async function sendGmail(args: {
  secret: CredentialSecret | undefined;
  raw: string;
  threadId?: string;
  where: string;
}): Promise<{ id: string; threadId: string; labelIds: string[] }> {
  return googleFetch(args.secret, {
    url: `${GMAIL_API}/messages/send`,
    method: "POST",
    body: {
      raw: args.raw,
      ...(args.threadId ? { threadId: args.threadId } : {}),
    },
    where: args.where,
  });
}

interface RawGmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: RawGmailPart[];
}

const headerOf = (parts: RawGmailPart, name: string): string =>
  parts.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";

/**
 * Flatten Gmail's nested part tree into a body and an attachment list.
 *
 * The tree is genuinely nested — `multipart/mixed` containing
 * `multipart/alternative` containing the text and HTML — so a one-level scan
 * finds the body of a plain message and nothing at all of a real one.
 */
function flattenParts(root: RawGmailPart): {
  text: string;
  html: string;
  attachments: GmailMessage["attachments"];
} {
  let text = "";
  let html = "";
  const attachments: GmailMessage["attachments"] = [];

  const walk = (part: RawGmailPart): void => {
    const mimeType = part.mimeType ?? "";

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: mimeType || "application/octet-stream",
        size: part.body.size ?? 0,
      });
      return;
    }

    if (part.body?.data) {
      const decoded = Buffer.from(part.body.data, "base64url").toString(
        "utf-8",
      );
      if (mimeType.startsWith("text/plain") && !text) {
        text = decoded;
      } else if (mimeType.startsWith("text/html") && !html) {
        html = decoded;
      }
    }

    for (const child of part.parts ?? []) {
      walk(child);
    }
  };

  walk(root);
  return { text, html, attachments };
}

/** Strip tags when only an HTML body exists, so a prompt gets readable text. */
const htmlToText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    // A paragraph or heading break reads as a blank line; a list item or table
    // row is one line. Collapsing both to "\n" runs prose together, and
    // expanding both to "\n\n" double-spaces every bullet.
    .replace(/<\/(p|div|h[1-6]|blockquote|section|article)>/gi, "\n\n")
    .replace(/<\/(tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    // Trim the space a stripped tag leaves against a newline. Without this
    // every line of the body starts with one — visible in a prompt, and in
    // anything that renders the text.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function parseGmailMessage(raw: {
  id?: string;
  threadId?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: RawGmailPart;
}): GmailMessage {
  const payload = raw.payload ?? {};
  const { text, html, attachments } = flattenParts(payload);

  return {
    id: raw.id ?? "",
    threadId: raw.threadId ?? "",
    from: headerOf(payload, "From"),
    to: headerOf(payload, "To"),
    subject: headerOf(payload, "Subject"),
    date: headerOf(payload, "Date"),
    snippet: raw.snippet ?? "",
    // Prefer real plain text; fall back to stripped HTML rather than handing a
    // model a page of markup and hoping.
    body: text || (html ? htmlToText(html) : ""),
    labelIds: raw.labelIds ?? [],
    attachments,
  };
}

/** List message ids matching a Gmail search query, bounded. */
export async function listGmailMessages(args: {
  secret: CredentialSecret | undefined;
  query: string;
  labelIds?: string[];
  limit: number;
  where: string;
}): Promise<{ ids: string[]; truncated: boolean }> {
  const result = await paginate({
    fetchPage: (pageToken) =>
      googleFetch<{
        messages?: Array<{ id?: string }>;
        nextPageToken?: string;
      }>(args.secret, {
        url: `${GMAIL_API}/messages`,
        query: {
          q: args.query || undefined,
          labelIds: args.labelIds?.join(",") || undefined,
          maxResults: 100,
          pageToken,
        },
        where: args.where,
      }),
    itemsOf: (page) =>
      (page.messages ?? [])
        .map((message) => message.id)
        .filter((id): id is string => Boolean(id)),
    nextTokenOf: (page) => page.nextPageToken,
    limit: args.limit,
  });

  return { ids: result.items, truncated: result.truncated };
}

export async function getGmailMessage(args: {
  secret: CredentialSecret | undefined;
  messageId: string;
  where: string;
}): Promise<GmailMessage> {
  const raw = await googleFetch<Parameters<typeof parseGmailMessage>[0]>(
    args.secret,
    {
      url: `${GMAIL_API}/messages/${encodeURIComponent(args.messageId)}`,
      query: { format: "full" },
      where: args.where,
    },
  );
  return parseGmailMessage(raw);
}
