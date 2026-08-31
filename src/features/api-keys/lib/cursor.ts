/**
 * Cursor pagination for the public API (AF-M8-01).
 *
 * Pure + isomorphic: cursor encode/decode never touches the DB, so it is
 * unit-testable in isolation. The cursor is a base64url-encoded JSON pair
 * `[sortValue, id]`. Sort values are ISO-8601 date strings, which compare
 * lexicographically in the same order as chronologically, so a descending
 * cursor uses `lte` (matches the last row) and an ascending `gt`/`lt` — no
 * custom collation needed.
 */

export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify([sortValue, id]), "utf8").toString(
    "base64url",
  );
}

export interface DecodedCursor {
  sortValue: string;
  id: string;
}

/** Decode a cursor. Returns null for anything malformed (the caller treats
 * it as no cursor / first page rather than failing the whole request). */
export function decodeCursor(
  raw: string | null | undefined,
): DecodedCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { sortValue: parsed[0], id: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}

/** Default and maximum page sizes, kept here for the REST boundary. */
export const CURSOR_PAGE_DEFAULTS = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/** Coerce a `limit` query value into a clamped page size. */
export function parseLimit(raw: string | null | undefined): number {
  if (typeof raw !== "string" || raw.trim() === "") {
    return CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT;
  if (n < 1) return CURSOR_PAGE_DEFAULTS.DEFAULT_LIMIT;
  return Math.min(Math.floor(n), CURSOR_PAGE_DEFAULTS.MAX_LIMIT);
}
