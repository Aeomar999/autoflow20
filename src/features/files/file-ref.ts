/**
 * `FileRef` — how a binary payload travels between nodes (AF-M10-06, ADR-0025).
 *
 * Isomorphic: the editor renders these in a trace, the engine passes them
 * between nodes, and tests build them. Nothing here touches storage.
 *
 * The shape is `{ $file: { … } }` rather than a bare object because a run
 * context is `Record<string, unknown>` and a node's output is whatever it
 * returns. A wrapper key is what lets any consumer — a downstream node, the
 * trace viewer, a template — recognise "this is a file, not data that happens
 * to have a `filename` field" without a schema.
 */

export const FILE_REF_KEY = "$file";

export interface FileRefValue {
  /** `StoredFile.id`. The only handle; the storage key is never exposed. */
  id: string;
  filename: string;
  mimeType: string;
  /** Bytes. Present so a node can reject an oversized file before fetching it. */
  size: number;
  /**
   * Content hash. Two nodes handed the same bytes produce the same value, which
   * is what lets the AF-M5-07 response cache key on attachment content
   * (AF-M10-07) instead of on a file id that changes every upload.
   */
  sha256: string;
}

export interface FileRef {
  [FILE_REF_KEY]: FileRefValue;
}

export function makeFileRef(value: FileRefValue): FileRef {
  return { [FILE_REF_KEY]: value };
}

/**
 * Is this value a file reference?
 *
 * Structural, not nominal: a `FileRef` survives a JSON round trip through
 * `NodeExecution.output` and comes back as a plain object, so an
 * `instanceof` check would be wrong everywhere it mattered.
 */
export function isFileRef(value: unknown): value is FileRef {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = (value as Record<string, unknown>)[FILE_REF_KEY];
  if (candidate === null || typeof candidate !== "object") {
    return false;
  }
  const file = candidate as Record<string, unknown>;
  return (
    typeof file.id === "string" &&
    file.id.length > 0 &&
    typeof file.filename === "string" &&
    typeof file.mimeType === "string" &&
    typeof file.size === "number" &&
    typeof file.sha256 === "string"
  );
}

/**
 * Every `FileRef` reachable from a value, at any depth.
 *
 * A node may return one file, an array of them, or a file nested inside a
 * result object. The retention sweep and the multimodal attachment resolver
 * both need "all of them" rather than "the one at a known path".
 */
export function collectFileRefs(
  value: unknown,
  out: FileRef[] = [],
): FileRef[] {
  if (isFileRef(value)) {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFileRefs(entry, out);
    }
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectFileRefs(entry, out);
    }
  }
  return out;
}

/** A short, human-readable size for error messages and the trace UI. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
