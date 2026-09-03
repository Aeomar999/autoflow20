import "server-only";
import { NonRetriableError } from "inngest";
import { manualTriggerChannel } from "@/inngest/channels/manual-trigger";
import type { NodeRun } from "@/nodes/types";

/** Runtime value types a mapping can emit (AF-M9-08). */
export type SetValueType = "string" | "number" | "boolean" | "object" | "array";

type SetData = {
  mappings?: Array<{ key: string; value: string; type?: SetValueType }>;
};

/**
 * Set node: applies a sequence of key-value mappings to the context.
 * Each value is a Handlebars template resolved against the current context.
 * Dot-paths in keys are supported (e.g. "user.name" sets context.user.name).
 *
 * A mapping's `type` decides how the compiled string is interpreted at runtime
 * (AF-M9-08). Non-string types are parsed strictly: a value that does not
 * parse as the declared type is a hard failure, never a silent coercion. The
 * deep clone in `setNestedValue` guarantees writing a nested path never
 * mutates an upstream node's recorded output.
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
      const compiled = resolve(mapping.value);
      const typed = parseTypedValue(
        mapping.key,
        mapping.type ?? "string",
        compiled,
      );
      setNestedValue(out, mapping.key, typed);
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
 * Interpret a mapping's compiled template output as its declared runtime type
 * (AF-M9-08). Every parse is strict: a value that cannot be read as the
 * declared type throws, naming the offending field, instead of silently
 * coercing (e.g. "true" is never coerced to boolean true, "42" never to a
 * number unless the type says number).
 */
function parseTypedValue(
  fieldKey: string,
  type: SetValueType,
  compiled: string,
): unknown {
  switch (type) {
    case "string":
      return compiled;
    case "number": {
      const trimmed = compiled.trim();
      if (trimmed === "") {
        throw new NonRetriableError(
          `Set node: "${fieldKey}" expects a number but resolved to an empty value`,
        );
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        throw new NonRetriableError(
          `Set node: "${fieldKey}" expects a number but resolved to "${compiled}"`,
        );
      }
      return parsed;
    }
    case "boolean": {
      const normalized = compiled.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
      throw new NonRetriableError(
        `Set node: "${fieldKey}" expects a boolean but resolved to "${compiled}"`,
      );
    }
    case "object":
    case "array": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(compiled);
      } catch {
        throw new NonRetriableError(
          `Set node: "${fieldKey}" expects a ${type} but resolved to "${compiled}", which is not valid JSON`,
        );
      }
      if (type === "array" && !Array.isArray(parsed)) {
        throw new NonRetriableError(
          `Set node: "${fieldKey}" expects an array but resolved to a non-array value`,
        );
      }
      if (
        type === "object" &&
        (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      ) {
        throw new NonRetriableError(
          `Set node: "${fieldKey}" expects an object but resolved to a non-object value`,
        );
      }
      return parsed;
    }
  }
}

/**
 * Set a value at a dot-separated path. Creates intermediate objects as
 * needed. Does not support array-index syntax (future enhancement).
 *
 * Clones-on-descend: before stepping into an existing nested object, it is
 * copied, so a nested write can never mutate `obj`'s ancestors' shared storage
 * (AF-M9-08). `obj` is ALWAYS expected to be a fresh top-level copy callers
 * build via `{ ...context }`.
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
      const clone: Record<string, unknown> = {
        ...(existing as Record<string, unknown>),
      };
      current[part] = clone;
      current = clone;
    } else {
      const next: Record<string, unknown> = {};
      current[part] = next;
      current = next;
    }
  }

  current[parts[parts.length - 1]] = value;
}
