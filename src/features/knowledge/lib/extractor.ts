import { decode } from "html-entities";
import mammoth from "mammoth";
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

/**
 * Give pdfjs a working `DOMMatrix` before it evaluates.
 *
 * pdfjs polyfills `DOMMatrix` itself, from `@napi-rs/canvas`, which it
 * resolves with a `createRequire(import.meta.url)` it builds at runtime.
 * Webpack replaces `import.meta.url` with the *build* machine's absolute path
 * and bakes it into the chunk, so in the lambda that require is rooted at
 * `/vercel/path0/...` - a directory that does not exist there. Module
 * resolution walks up from that root and never reaches `/var/task`, so the
 * package resolves to nothing however much `outputFileTracingIncludes` ships.
 * pdfjs then leaves `DOMMatrix` unset, and its module-scope `new DOMMatrix()`
 * throws `ReferenceError` while the module body evaluates.
 *
 * `api/inngest/route.ts` used to hold that off with an empty
 * `class DOMMatrix {}`. It stopped the crash, but because pdfjs only
 * polyfills when the global is absent, the placeholder won and pdfjs ran with
 * a matrix that cannot transform anything.
 *
 * Doing it here works where pdfjs cannot because `@napi-rs/canvas` is listed
 * in `serverExternalPackages`: webpack leaves a real `require()` in the
 * chunk, and Node resolves that from the chunk's own directory upwards into
 * the lambda's `node_modules`, where the tracer has already put the package.
 *
 * Only `DOMMatrix` is repaired. pdfjs reaches `createCanvas` through the same
 * dead require, so rasterising a PDF would still fail in the lambda - nothing
 * here does that, `getText` is the only entry point this file uses.
 */
export async function ensureDomMatrix(): Promise<void> {
  if (typeof globalThis.DOMMatrix !== "undefined") return;

  const canvas = await import("@napi-rs/canvas");
  globalThis.DOMMatrix = canvas.DOMMatrix as unknown as typeof DOMMatrix;
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
    // Imported here rather than at module scope. `pdf-parse` pulls in
    // `pdfjs-dist`, which reaches for `@napi-rs/canvas` through a `createRequire`
    // it builds at runtime and touches `DOMMatrix` while its module body
    // evaluates. Neither webpack nor Vercel's file tracer can see that
    // require, so the package never reaches the lambda and the reference throws
    // on import - taking down every route whose graph reached this file, which
    // `src/nodes/registry.ts` (it imports every executor) makes into all of
    // them. Only the runner ever parses a PDF; a parser this heavy has no
    // business loading for a request that never sees one.
    //
    // Deliberately outside the try below: a module that fails to load is an
    // environment fault, and reporting it as "this PDF is corrupt" would be the
    // same dishonesty DocumentExtractionError exists to avoid.

    // Both of these repair something webpack breaks by inlining pdfjs, and
    // both have to happen before pdfjs evaluates - which is the `pdf-parse`
    // import below, not this line.
    await ensureDomMatrix();

    // pdfjs parses in a worker. On Node it loads that worker in-process from
    // `GlobalWorkerOptions.workerSrc`, which defaults to the relative
    // `"./pdf.worker.mjs"` and is loaded through a dynamic import marked
    // `webpackIgnore` - so webpack neither rewrites the specifier nor emits
    // the file, and it resolves against whatever directory pdfjs was inlined
    // into. In `node_modules` that is the worker's own folder; in the Vercel
    // build it is `.next/server/chunks/`, and every PDF died there with
    // `Setting up fake worker failed: "Cannot find module
    // '/var/task/.next/server/chunks/pdf.worker.mjs'"`.
    //
    // pdfjs checks `globalThis.pdfjsWorker` before it ever looks at
    // `workerSrc`, so handing it the worker here means that resolution never
    // runs. This specifier is static, so webpack bundles the worker as a lazy
    // chunk of its own rather than leaving behind a path that happens to
    // resolve in `node_modules` and nowhere else.
    const globals = globalThis as typeof globalThis & {
      pdfjsWorker?: typeof import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    };
    globals.pdfjsWorker ??= await import(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs"
    );

    const { PDFParse } = await import("pdf-parse");

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
