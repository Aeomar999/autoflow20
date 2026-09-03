import "server-only";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

type SetData = {
  mappings?: Array<{ key: string; value: string }>;
};

/**
 * Set node: applies a sequence of key-value mappings to the context.
 * Each value is a Handlebars template resolved against the current context.
 * Dot-paths in keys are supported (e.g. "user.name" sets context.user.name).
 */
export const execute: NodeRun<SetData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
}) => {
  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  const result = await step.run("set", async () => {
    const out = { ...context };

    for (const mapping of data.mappings ?? []) {
      const resolved = resolve(mapping.value);
      setNestedValue(out, mapping.key, resolved);
    }

    return out;
  });

  await publish(
    manualTriggerChannel().status({
      nodeId,
      status: "success",
    }),
  );

  return result;
};

/**
 * Set a value at a dot-separated path. Creates intermediate objects
 * as needed. Does not support array-index syntax (future enhancement).
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = current[part];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      current = existing as Record<string, unknown>;
    } else {
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    }
  }

  current[parts[parts.length - 1]] = value;
}
