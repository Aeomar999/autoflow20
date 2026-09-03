import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * `FORM_TRIGGER` (AF-M10-14).
 *
 * A trigger executor does no work: by the time the run exists, the submission
 * is already in its initial data. This exists so the node has a row in the
 * trace like any other — the submission is what a debugging user opens first.
 */
export const execute: NodeRun = async ({ context, step }) =>
  step.run("form-trigger", async () => ({ ...context }));
