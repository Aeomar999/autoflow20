import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";
import type { CodeData } from "./definition";
import { CodeExecutionError, resolveCaps, runUserCode } from "./sandbox";

/**
 * Code node (AF-M9-13): run the user's JavaScript body against this node's
 * resolved input inside the ADR-0020 sandbox (worker thread + `node:vm`).
 *
 * The sandbox owns its caps (wall clock, heap, output) independent of the
 * engine's outer node timeout; the sandbox's own cap breach is what the user
 * sees, never a silent truncation.
 *
 * Return contract: an object return is the node's output verbatim; an array
 * return is stored under `items` so a downstream SPLIT_OUT can iterate it.
 * Any error — the user's thrown error (with their line number), a cap breach,
 * or an unexpected exit — surfaces as a `NonRetriableError`.
 */
export const execute: NodeRun<CodeData> = async ({
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

  const result = await step.run("code", async () => {
    const caps = resolveCaps({
      wallClockMs: data.limitTimeoutMs,
      heapMb: data.limitHeapMb,
      outputBytes: data.limitOutputBytes,
    });

    let value: unknown;
    try {
      value = await runUserCode(data.code, context, caps);
    } catch (err) {
      if (err instanceof CodeExecutionError) {
        const line = err.userLineNumber ? ` (line ${err.userLineNumber})` : "";
        throw new NonRetriableError(`Code node: ${err.message}${line}`);
      }
      throw err;
    }

    if (Array.isArray(value)) {
      return { items: value };
    }
    if (value !== null && typeof value === "object") {
      return value;
    }
    // A primitive return has nowhere meaningful to go — surface it loudly
    // rather than store a valueless output.
    throw new NonRetriableError(
      `Code node: expected an object or array return but got ${typeof value}`,
    );
  });

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};
