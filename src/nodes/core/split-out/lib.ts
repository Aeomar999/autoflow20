/**
 * Resolve a dot-path (e.g. "data.records.items") inside an arbitrary object.
 *
 * Returns `undefined` when any segment along the path is missing. Numeric
 * path segments index into arrays. Used by SPLIT_OUT (AF-M9-14) to locate the
 * array to iterate. This module is isomorphic so the engine can share it with
 * the node without pulling the server-only executor into the client.
 */
export function getPath(root: unknown, path: string): unknown {
  if (!path) {
    return root;
  }
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object" && segment in (current as object)) {
      current = (current as Record<string, unknown>)[segment];
    } else if (
      Array.isArray(current) &&
      /^\d+$/.test(segment) &&
      Number(segment) < current.length
    ) {
      current = current[Number(segment)];
    } else {
      return undefined;
    }
  }
  return current;
}
