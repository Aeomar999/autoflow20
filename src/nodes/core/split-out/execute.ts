import "server-only";
import { NonRetriableError } from "inngest";
import type { NodeRun } from "@/nodes/types";
import type { SplitOutConfig } from "./definition";
import { getPath } from "./lib";

/**
 * SPLIT_OUT execute (AF-M9-14, ADR-0021): validate that the configured path
 * resolves to an array and hand the engine `{ items, count }` to drive the
 * segment iteration.
 *
 * The engine — not this executor — enforces `maxItems` before iterating, so a
 * cap-exceeded array fails the whole run cleanly rather than partially running
 * and reporting success. This executor only hard-fails when the configured
 * path is missing or resolves to a non-array, which can never back a
 * meaningful iteration.
 */
export const execute: NodeRun<SplitOutConfig> = async ({ data, context }) => {
  const resolved = data.path ? getPath(context, data.path) : undefined;

  if (!Array.isArray(resolved)) {
    throw new NonRetriableError(
      `SPLIT_OUT: path "${data.path}" did not resolve to an array in the node input` +
        (resolved === undefined ? " (value not found)" : ""),
    );
  }

  return { items: resolved, count: resolved.length };
};
