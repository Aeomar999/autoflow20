import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs, formatFileSize } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import {
  documentTypeLabel,
  extractTextFromBuffer,
} from "@/features/knowledge/lib/extractor";
import { type AiModelDef, findModelForCandidate } from "@/lib/ai/registry";

/**
 * Attachments for `AI_LLM` and `AI_EXTRACT` (AF-M10-07).
 *
 * The registry has declared a `vision` capability on five models since M5 and
 * nothing could reach it: no node let a user attach an image or a PDF to a
 * prompt. Four automations need it — reading an invoice, a fax, a video brief.
 *
 * Shared by both AI nodes because the hard parts are identical: resolving the
 * references, refusing a model that cannot see, deciding what to do with a PDF,
 * and keeping the response cache honest about which bytes were sent.
 */

/**
 * Bytes of attachment per node run.
 *
 * Providers reject far smaller payloads than this, but the number that matters
 * here is memory: attachments are buffered whole to be base64-encoded into the
 * request. 20 MB across all attachments is comfortably more than any real
 * invoice or contract page and small enough not to threaten the worker.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Attachments per node run. A prompt with fifty images is a mistake. */
export const MAX_ATTACHMENT_COUNT = 10;

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/**
 * Adapters whose API accepts a PDF as a file part.
 *
 * Anthropic and Google take `application/pdf` directly and do their own page
 * rendering, which preserves layout — the thing that matters when reading an
 * invoice. OpenAI's chat-completions surface does not, so a PDF sent there
 * would be silently ignored or rejected depending on the version; those
 * providers get extracted text instead, and the node records which path ran.
 */
const NATIVE_PDF_ADAPTERS = new Set(["anthropic", "google"]);

export type AttachmentPart =
  | { type: "image"; image: Buffer; mediaType: string }
  | { type: "file"; data: Buffer; mediaType: string; filename: string };

export interface ResolvedAttachments {
  /** Parts to add to the model message. Empty when nothing was attached. */
  parts: AttachmentPart[];
  /**
   * Text pulled out of documents the chosen provider cannot read natively.
   * Appended to the prompt by the caller, so a PDF still reaches a model that
   * has no document input rather than being silently dropped.
   */
  extractedText: string;
  /**
   * Content hashes of everything attached, in order. Folded into the AF-M5-07
   * cache key: two different invoices must not share a cache entry, and two
   * copies of one should.
   */
  sha256s: string[];
  /**
   * What actually happened, recorded in the node's output so a user can see
   * which path ran instead of guessing why a PDF read badly.
   */
  handling: Array<{
    filename: string;
    mimeType: string;
    size: number;
    via: "image" | "native-document" | "extracted-text";
  }>;
  totalBytes: number;
}

export const EMPTY_ATTACHMENTS: ResolvedAttachments = {
  parts: [],
  extractedText: "",
  sha256s: [],
  handling: [],
  totalBytes: 0,
};

export function assertVisionCapable(
  candidates: string[],
  where: string,
): AiModelDef[] {
  const models: AiModelDef[] = [];
  for (const candidate of candidates) {
    const model = findModelForCandidate(candidate);
    if (!model) {
      // An unresolvable model is `executeWithFallback`'s error to report, with
      // its own message about providers. Skipping it here keeps one owner for
      // that failure instead of two that phrase it differently.
      continue;
    }
    if (!model.capabilities.includes("vision")) {
      throw new NonRetriableError(
        `${where}: model "${candidate}" does not support the "vision" capability, so it cannot read an attachment. ` +
          "Choose a vision-capable model, or remove the attachment.",
      );
    }
    models.push(model);
  }
  return models;
}

/**
 * Resolve a template into attachment parts for one provider.
 *
 * `servedAdapter` decides PDF handling, so this runs per candidate rather than
 * once: the primary model may read PDFs natively while its fallback does not,
 * and pretending otherwise would send a fallback a payload it cannot use.
 */
export async function resolveAttachments(args: {
  /** Already-resolved template output: a FileRef, an array of them, or JSON. */
  rendered: string;
  organizationId: string;
  /** Adapter of the model this call will use. */
  adapter: AiModelDef["adapter"];
  where: string;
}): Promise<ResolvedAttachments> {
  const trimmed = args.rendered.trim();
  if (trimmed.length === 0) {
    return EMPTY_ATTACHMENTS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new NonRetriableError(
      `${args.where}: the attachments expression did not resolve to a file reference. ` +
        "Use three braces so the reference survives — {{{json download.file}}} — rather than two.",
    );
  }

  const refs = collectFileRefs(parsed);
  if (refs.length === 0) {
    throw new NonRetriableError(
      `${args.where}: the attachments expression resolved to a value containing no file references.`,
    );
  }
  if (refs.length > MAX_ATTACHMENT_COUNT) {
    throw new NonRetriableError(
      `${args.where}: ${refs.length} attachments exceeds the ${MAX_ATTACHMENT_COUNT}-attachment limit for one call.`,
    );
  }

  const result: ResolvedAttachments = {
    parts: [],
    extractedText: "",
    sha256s: [],
    handling: [],
    totalBytes: 0,
  };

  const extractedChunks: string[] = [];

  for (const ref of refs) {
    const meta = ref.$file;
    result.totalBytes += meta.size;
    if (result.totalBytes > MAX_ATTACHMENT_BYTES) {
      throw new NonRetriableError(
        `${args.where}: attachments total ${formatFileSize(result.totalBytes)}, over the ${formatFileSize(MAX_ATTACHMENT_BYTES)} limit for one call.`,
      );
    }

    // Org-scoped (ADR-0025): a FileRef is a plain object a CODE node could
    // mint, so the id alone is not authorization.
    const file = await readFile({
      fileId: meta.id,
      organizationId: args.organizationId,
    });
    result.sha256s.push(meta.sha256);

    const mimeType = (file.mimeType || meta.mimeType || "").toLowerCase();

    if (IMAGE_TYPES.has(mimeType)) {
      result.parts.push({
        type: "image",
        image: file.data,
        mediaType: mimeType,
      });
      result.handling.push({
        filename: file.filename,
        mimeType,
        size: meta.size,
        via: "image",
      });
      continue;
    }

    if (mimeType === "application/pdf") {
      if (NATIVE_PDF_ADAPTERS.has(args.adapter)) {
        result.parts.push({
          type: "file",
          data: file.data,
          mediaType: "application/pdf",
          filename: file.filename,
        });
        result.handling.push({
          filename: file.filename,
          mimeType,
          size: meta.size,
          via: "native-document",
        });
        continue;
      }

      // This provider has no document input. Extracting text is lossy —
      // layout and tables suffer — but it is far better than dropping the
      // attachment, and `handling` says which path ran so a poor reading has
      // a visible cause.
      const extracted = await extractTextFromBuffer(file.data, mimeType);
      extractedChunks.push(
        `--- ${file.filename} (text extracted; this provider cannot read PDFs directly) ---\n${extracted.text}`,
      );
      result.handling.push({
        filename: file.filename,
        mimeType,
        size: meta.size,
        via: "extracted-text",
      });
      continue;
    }

    // Anything else the document extractor understands becomes text; anything
    // it does not is refused by name rather than sent as bytes the model will
    // read as noise.
    if (documentTypeLabel(mimeType || file.filename)) {
      const extracted = await extractTextFromBuffer(
        file.data,
        mimeType || file.filename,
      );
      extractedChunks.push(`--- ${file.filename} ---\n${extracted.text}`);
      result.handling.push({
        filename: file.filename,
        mimeType,
        size: meta.size,
        via: "extracted-text",
      });
      continue;
    }

    throw new NonRetriableError(
      `${args.where}: "${file.filename}" is ${mimeType || "of an unknown type"}, which cannot be attached to a prompt. ` +
        "Attach an image (PNG, JPEG, WebP, GIF), a PDF, or a document this platform can read as text.",
    );
  }

  result.extractedText = extractedChunks.join("\n\n");
  return result;
}
