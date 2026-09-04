import "server-only";
import type { NodeRun } from "@/nodes/types";

/**
 * The trigger contributes no work of its own: the webhook route verifies the
 * signature, resolves the realm to a credential and dispatches the run with
 * `qbo.*` already in the initial context. Executing is a pass-through so the
 * node appears in the trace as the run's starting point.
 */
export const execute: NodeRun = async ({ context, step }) =>
  step.run("qbo-webhook-trigger", async () => context);
