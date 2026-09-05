import "server-only";
import type { NodeRun } from "@/nodes/types";

/** The message is already in the run's initial data; this is the trace row. */
export const execute: NodeRun = async ({ context, step }) =>
  step.run("gmail-trigger", async () => ({ ...context }));
