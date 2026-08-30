import { decode } from "html-entities";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { assertSafeEndpoint } from "@/features/executions/components/http-request/egress-guard";

export interface ExtractedDocument {
  title?: string;
  text: string;
  sizeBytes: number;
  mimeType?: string;
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

  if (identifier.includes("pdf") || identifier.endsWith(".pdf")) {
    detectedMime = "application/pdf";
    try {
      const parser = new PDFParse({ data: buffer });
      const res = await parser.getText();
      text = res.text || "";
    } catch {
      text = buffer.toString("utf-8");
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
  };
}

export async function extractTextFromUrl(
  urlString: string,
): Promise<ExtractedDocument> {
  const safeUrl = await assertSafeEndpoint(urlString);

  const response = await fetch(safeUrl.href, {
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
