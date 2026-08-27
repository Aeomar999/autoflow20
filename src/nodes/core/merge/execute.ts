import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";
import type { MergeData } from "./definition";

/**
 * Merge node: combines data from upstream branches.
 *
 * Because the current engine threads a single accumulated context,
 * the merge node receives all upstream outputs in the flat context.
 * This node restructures that context based on the merge mode.
 *
 * Modes:
 * - "append" (default): concatenates all arrays found in the context
 *   into a single "items" array.
 * - "mergeByKey": deep-merges all objects in the context.
 * - "combine": creates an object keyed by upstream node name (or
 *   combineKey), with each node's output as the value.
 */
export const execute: NodeRun<MergeData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("merge", async () => {
    const mode = data.mode ?? "append";

    switch (mode) {
      case "append": {
        // Collect all arrays from the context and flatten them.
        const items: unknown[] = [];
        for (const value of Object.values(context)) {
          if (Array.isArray(value)) {
            items.push(...value);
          } else if (value !== null && typeof value === "object") {
            items.push(value);
          }
        }
        return { ...context, items };
      }

      case "mergeByKey": {
        // Deep-merge all object values. Last one wins on conflicts.
        const merged: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(context)) {
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            deepMerge(merged, value as Record<string, unknown>);
          } else {
            merged[key] = value;
          }
        }
        return merged;
      }

      case "combine": {
        // Wrap the context under a single key.
        const combineKey = data.combineKey ?? "combined";
        return { ...context, [combineKey]: { ...context } };
      }

      default:
        throw new NonRetriableError(
          `Merge node: unknown mode "${mode}"`,
        );
    }
  });

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};

/** Shallow-deep merge: recursively merges objects; arrays and primitives overwrite. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      target[key] !== null &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMerge(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      target[key] = value;
    }
  }
}
