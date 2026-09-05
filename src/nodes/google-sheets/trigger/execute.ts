import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * A polling trigger's executor does no fetching: by the time the run exists,
 * the row is already in its initial data. It exists so the node has a trace
 * row like any other — the row that started the run is what a debugging user
 * opens first.
 */
export const execute: NodeRun = async ({ context, step }) =>
  step.run("sheets-trigger", async () => ({ ...context }));
