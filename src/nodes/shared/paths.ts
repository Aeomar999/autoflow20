/**
 * Dot-path reads and comparison stringification (AF-M10-10).
 *
 * Used where a node must address a field of a value it is iterating itself,
 * rather than of the run context — `FILTER` and `DEDUPE` outside a fan-out
 * segment. A Handlebars template cannot do this: it is compiled against the
 * *node's* context, and the engine only puts `$item` in scope for segment
 * interiors.
 *
 * Isomorphic; no dependencies.
 */

/**
 * Read `a.b.0.c` out of a value.
 *
 * An empty path returns the value itself, which is what "compare the element"
 * means for an array of scalars. A path that does not resolve returns
 * `undefined` rather than throwing — a missing field is an ordinary thing to
 * filter on, and a run should not die on the first row with a blank cell.
 */
export function readPath(value: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed === "") {
    return value;
  }

  let current: unknown = value;
  for (const segment of trimmed.split(".")) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Render a value as the string `compareTyped` will parse.
 *
 * Deliberately NOT `JSON.stringify` for scalars: that would wrap a string in
 * quotes, so `"active"` would never equal `active`. Objects and arrays do get
 * JSON, because there is no other sensible text form and comparing them is
 * almost always a mistake the author should see rather than a silent
 * `[object Object]`.
 *
 * `null` and `undefined` become the empty string, which is what makes
 * `is_empty` mean "absent or blank" — the question people actually ask.
 */
export function stringifyForCompare(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}
