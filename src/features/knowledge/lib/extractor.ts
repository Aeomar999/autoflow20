import { decode } from "html-entities";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import {
  assertSafeEndpoint,
  safeFetch,
} from "@/features/executions/components/http-request/egress-guard";

export interface ExtractedDocument {
  title?: string;
  text: string;
  sizeBytes: number;
  mimeType?: string;
  /** Pages, for formats that have them (PDF). Absent for HTML, DOCX, text. */
  pageCount?: number;
}

/**
 * A document whose bytes are not readable as the type they claim to be
 * (AF-M10-11).
 *
 * The PDF path used to fall back to `buffer.toString("utf-8")` when parsing
 * failed, which turns a corrupt or password-protected file into a page of
 * mojibake that then gets chunked, embedded and answered from. Failing loudly
 * is the only honest option: the caller can decide to skip the document, but
 * it cannot un-poison an index it did not know was poisoned.
 */
export class DocumentExtractionError extends Error {
  constructor(
    message: string,
    readonly mimeType: string,
  ) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

export function normalizeText(rawText: string): string {
  if (!rawText) return "";

  return rawText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n\n+/g, "\n\n")
    .trim();
}

export function extractTextFromHtml(html: string): string {
  if (!html) return "";

  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");

  cleaned = cleaned.replace(
    /<\/(p|div|h[1-6]|li|tr|section|article|head|body|header|footer)>/gi,
    "\n\n",
  );
  cleaned = cleaned.replace(/<br\s*[/]?>/gi, "\n");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  const decoded = decode(cleaned);
  return normalizeText(decoded);
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeTypeOrFilename: string,
): Promise<ExtractedDocument> {
  const identifier = mimeTypeOrFilename.toLowerCase();
  let text = "";
  let detectedMime = "text/plain";

  let pageCount: number | undefined;

  if (identifier.includes("pdf") || identifier.endsWith(".pdf")) {
    detectedMime = "application/pdf";
    try {
      const parser = new PDFParse({ data: buffer });
      const res = await parser.getText();
      text = res.text || "";
      pageCount = res.total;
    } catch (error) {
      throw new DocumentExtractionError(
        `Could not read this PDF: ${error instanceof Error ? error.message : String(error)}. ` +
          "It may be corrupt, password-protected, or not a PDF at all.",
        detectedMime,
      );
    }
  } else if (
    identifier.includes("wordprocessingml") ||
    identifier.includes("docx") ||
    identifier.endsWith(".docx")
  ) {
    detectedMime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (
    identifier.includes("html") ||
    identifier.endsWith(".html") ||
    identifier.endsWith(".htm")
  ) {
    detectedMime = "text/html";
    text = extractTextFromHtml(buffer.toString("utf-8"));
  } else {
    detectedMime = identifier.endsWith(".md") ? "text/markdown" : "text/plain";
    text = buffer.toString("utf-8");
  }

  const normalized = normalizeText(text);

  return {
    text: normalized,
    sizeBytes: buffer.length,
    mimeType: detectedMime,
    pageCount,
  };
}

export async function extractTextFromUrl(
  urlString: string,
): Promise<ExtractedDocument> {
  const safeUrl = await assertSafeEndpoint(urlString);

  const response = await safeFetch(safeUrl.href, {
    method: "GET",
    headers: {
      "User-Agent": "AutoFlow-Bot/1.0 (+https://autoflow.local)",
      Accept: "text/html,text/plain,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type") || "text/html";
  const rawBody = await response.text();

  let text = rawBody;
  if (contentType.includes("html")) {
    text = extractTextFromHtml(rawBody);
  } else {
    text = normalizeText(rawBody);
  }

  const titleMatch = rawBody.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1]).trim() : undefined;

  return {
    title,
    text,
    sizeBytes: Buffer.byteLength(rawBody, "utf-8"),
    mimeType: contentType,
  };
}

/**
 * Formats `extractTextFromBuffer` genuinely understands (AF-M10-11).
 *
 * The extractor's final `else` decodes anything unrecognised as UTF-8 text.
 * For the knowledge base that is a reasonable default — a `.log` or a `.csv`
 * really is text. For a node it is not: handing it a PNG would "succeed" with
 * a page of binary garbage, and the user would find out from the model's
 * answer rather than from the node. `EXTRACT_DOCUMENT_TEXT` therefore checks
 * this first and refuses anything not on it, naming the type.
 */
export const SUPPORTED_DOCUMENT_TYPES = [
  { label: "PDF", match: ["pdf"] },
  { label: "DOCX", match: ["wordprocessingml", "docx"] },
  { label: "HTML", match: ["html", "xhtml"] },
  { label: "plain text", match: ["text/plain", "txt"] },
  { label: "Markdown", match: ["markdown", ".md"] },
  { label: "CSV", match: ["csv"] },
  { label: "JSON", match: ["json"] },
] as const;

/** The human label for a supported type, or null when it is not supported. */
export function documentTypeLabel(mimeTypeOrFilename: string): string | null {
  const identifier = mimeTypeOrFilename.toLowerCase();
  for (const { label, match } of SUPPORTED_DOCUMENT_TYPES) {
    if (match.some((needle) => identifier.includes(needle))) {
      return label;
    }
  }
  return null;
}
