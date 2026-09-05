import "server-only";
import type { NodeRun } from "@/nodes/types";

/** The event is already in the run initial data; this is the trace row. */
export const execute: NodeRun = async ({ context, step }) =>
  step.run("calendar-trigger", async () => ({ ...context }));
