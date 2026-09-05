import "server-only";
import { NonRetriableError } from "inngest";
import { isFileRef } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import {
  DocumentExtractionError,
  documentTypeLabel,
  extractTextFromBuffer,
  SUPPORTED_DOCUMENT_TYPES,
} from "@/features/knowledge/lib/extractor";
import type { NodeRun } from "@/nodes/types";

/**
 * `EXTRACT_DOCUMENT_TEXT` (AF-M10-11).
 *
 * The extraction itself is the knowledge base's — one implementation, not a
 * copy. What this node adds is the part a graph needs and an ingestion
 * pipeline does not: resolving a `FileRef`, refusing a type the extractor
 * would silently decode as text, and reporting truncation instead of applying
 * it quietly.
 */

const DEFAULT_MAX_CHARACTERS = 200_000;

type ExtractDocumentTextData = {
  variableName?: string;
  file?: string;
  maxCharacters?: number;
};

/**
 * A resolved template can be a `FileRef` serialized to JSON, a bare id, or —
 * when someone templates `{{download.file}}` into a string context — the
 * `[object Object]` that Handlebars produces. The last case is a
 * configuration mistake worth naming, because it looks like an id.
 */
function resolveFileId(resolved: string): string {
  const trimmed = resolved.trim();

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isFileRef(parsed)) {
        return parsed.$file.id;
      }
      const asRecord = parsed as { id?: unknown };
      if (typeof asRecord.id === "string" && asRecord.id.length > 0) {
        return asRecord.id;
      }
    } catch {
      // Not JSON after all — fall through to the plain-id path below.
    }
  }

  if (trimmed === "[object Object]") {
    throw new NonRetriableError(
      'Extract Document Text node: the file expression rendered as "[object Object]". ' +
        "Point it at the file itself (e.g. {{download.file}}), not at a value that contains one.",
    );
  }

  if (trimmed.length === 0) {
    throw new NonRetriableError(
      "Extract Document Text node: the file expression resolved to nothing.",
    );
  }

  return trimmed;
}

export const execute: NodeRun<ExtractDocumentTextData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
}) =>
  step.run("extract-document-text", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Extract Document Text node: Variable name not configured",
      );
    }
    if (!data.file) {
      throw new NonRetriableError(
        "Extract Document Text node: No file configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Extract Document Text node: this run has no organization, so its files cannot be read.",
      );
    }

    const fileId = resolveFileId(resolve(data.file));

    // Org-scoped by construction (ADR-0025): a FileRef is a plain object a
    // CODE node could mint, so the id alone is not authorization.
    const file = await readFile({ fileId, organizationId });

    const label = documentTypeLabel(file.mimeType || file.filename);
    if (!label) {
      throw new NonRetriableError(
        `Extract Document Text node: "${file.filename}" is ${file.mimeType || "of an unknown type"}, which this node cannot read. ` +
          `Supported: ${SUPPORTED_DOCUMENT_TYPES.map((t) => t.label).join(", ")}.`,
      );
    }

    let extracted: Awaited<ReturnType<typeof extractTextFromBuffer>>;
    try {
      extracted = await extractTextFromBuffer(
        file.data,
        file.mimeType || file.filename,
      );
    } catch (error) {
      if (error instanceof DocumentExtractionError) {
        // Already a readable, type-aware message; re-raise as non-retriable
        // because a corrupt file does not become readable on a second attempt.
        throw new NonRetriableError(
          `Extract Document Text node: ${error.message}`,
        );
      }
      throw error;
    }

    const cap = data.maxCharacters ?? DEFAULT_MAX_CHARACTERS;
    const truncated = extracted.text.length > cap;
    const text = truncated ? extracted.text.slice(0, cap) : extracted.text;

    return {
      ...context,
      [data.variableName]: {
        text,
        // Absent for formats with no pages (DOCX, HTML, text) rather than a
        // fabricated 1 — a downstream "page 3 of 1" is worse than a null.
        pageCount: extracted.pageCount ?? null,
        // Reported, never silently applied: a contract analysed from its first
        // half produces a confident, wrong answer.
        truncated,
        characterCount: text.length,
        filename: file.filename,
        mimeType: file.mimeType,
        format: label,
      },
    };
  });
