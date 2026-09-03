import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";
import { byInputKey, type MergeData, resolveInputs } from "./definition";

/**
 * Merge node (AF-M9-11, v2): combines data from multiple upstream branches.
 *
 * Since AF-M9-12 the engine delivers each node's input resolved from its
 * incoming edges. For a config-derived-input node like MERGE that input is
 * keyed by port id — `context["input-0"]`, `context["input-1"]`, … — with the
 * value `null` when a port is unattached or on an untaken branch.
 *
 * Modes:
 * - "byInput" (default): `{ input0, input1, … }` — every branch under a key
 *   derived from its port index (W2 shape). An unattached / skipped branch is
 *   `null`, so it can be told apart from a branch that produced an empty
 *   object.
 * - "append": concatenates all arrays found across the branches into `items`.
 * - "mergeByKey": deep-merges the branch objects, later branches overriding.
 * - "combine": a single object with every branch under `combineKey` (v1 legacy).
 *
 * Defensive: if the incoming context was built by a pre-v2 shape (no port
 * keys — e.g. a hand-placed flat context), the executor treats the whole
 * context as one flat input rather than crashing.
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
    const mode = data.mode ?? "byInput";
    const ports = resolveInputs(data);

    // Port-keyed view of the incoming context. A node fed by the engine
    // (AF-M9-12) arrives keyed by port id; anything else is treated as a single
    // flat input for v1 compatibility.
    const hasPortKeys = ports.some(
      (p) => (context as Record<string, unknown>)[p.id] !== undefined,
    );
    const portValues: Record<string, unknown> = {};
    for (const port of ports) {
      portValues[port.id] = hasPortKeys
        ? ((context as Record<string, unknown>)[port.id] ?? null)
        : context;
    }

    switch (mode) {
      case "byInput": {
        // W2 shape: port id `input-0` → key `input0`, value null when absent.
        const out: Record<string, unknown> = {};
        for (const port of ports) {
          out[byInputKey(port.id)] = portValues[port.id];
        }
        return out;
      }

      case "append": {
        // Concatenate each branch's item list into one "items" array. A branch
        // is either an item-list object `{ items: [...] }` (v2 keyed context)
        // or, pre-v2, a bare array in a flat context — both are flattened.
        const items: unknown[] = [];
        for (const value of Object.values(portValues)) {
          if (Array.isArray(value)) items.push(...value);
          else if (value !== null && typeof value === "object") {
            const arr = (value as Record<string, unknown>).items;
            if (Array.isArray(arr)) items.push(...arr);
          }
        }
        return { ...portValues, items };
      }

      case "mergeByKey": {
        // Deep-merge all branch objects. Last one wins on conflicts.
        const merged: Record<string, unknown> = {};
        for (const value of Object.values(portValues)) {
          if (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
          ) {
            deepMerge(merged, value as Record<string, unknown>);
          }
        }
        return merged;
      }

      case "combine": {
        // Wrap every branch under one key (v1 semantics).
        const combineKey = data.combineKey ?? "combined";
        return { ...portValues, [combineKey]: { ...portValues } };
      }

      default:
        throw new NonRetriableError(`Merge node: unknown mode "${mode}"`);
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
