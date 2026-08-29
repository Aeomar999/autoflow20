import type { ZodTypeAny } from "zod";
import type { CredentialRequirement } from "@/nodes/types";

/**
 * Schema-driven config introspection (AF-M1-06).
 *
 * Turns a node definition's `configSchema` into a flat list of renderable
 * fields for the config panel. Supported constructs:
 *
 *   string   → "string" | "multiline"    number        → "number"
 *   boolean  → "boolean"                 z.enum        → "enum"
 *   record<string,string>                → "kv-list"
 *   array<{key,value}>.max(50)           → "keyValueList"
 *   field whose key matches a definition.credentials entry → "credential"
 *   optional / nullable / default wrappers → flagged `optional`
 *
 * Anything else throws `UnsupportedConfigFieldError` so the panel can fail
 * loudly at dev time instead of silently dropping a field.
 *
 * Zod version note: this reads `schema._def`, which is an internal shape and
 * NOT stable API. It is pinned to zod@^4.1.11 (see package.json); the
 * catalogue-scan test (config-schema.test.ts) guards against surprising shapes
 * drifting in.
 *
 * Multiline heuristic: string `min`/`max`/`refine` checks are opaque in Zod v4
 * (they expose only `{ _zod }`), so a string is "multiline" iff the schema
 * accepts a value containing a line break. Free-text prompts therefore render
 * as textareas, while identifier / URL / email fields (whose constraints
 * reject `\n`) render as single-line inputs.
 */

export type ConfigFieldKind =
  | "string"
  | "multiline"
  | "number"
  | "boolean"
  | "enum"
  | "kv-list"
  | "keyValueList"
  | "credential";

export interface ResolvedConfigField {
  key: string;
  kind: ConfigFieldKind;
  label: string;
  description?: string;
  optional: boolean;
  enumValues?: readonly string[];
  /** Set only for `credential` fields. */
  credential: CredentialRequirement | null;
}

export class UnsupportedConfigFieldError extends Error {
  readonly key: string;

  constructor(key: string, detail: string) {
    super(`The field "${key}" ${detail}`);
    this.name = "UnsupportedConfigFieldError";
    this.key = key;
  }
}

const MULTILINE_PROBE = "alpha\nbeta";

interface Def {
  type: string;
  [key: string]: unknown;
}

function defOf(schema: ZodTypeAny): Def {
  return (schema as unknown as { _def: Def })._def;
}

/** Unwraps z.optional() / z.nullable() / z.default() and records optionality. */
function unwrap(schema: ZodTypeAny): {
  schema: ZodTypeAny;
  optional: boolean;
} {
  let current = schema;
  let optional = false;
  for (let depth = 0; depth < 4; depth += 1) {
    const def = defOf(current);
    if (
      def.type === "optional" ||
      def.type === "nullable" ||
      def.type === "default"
    ) {
      optional = true;
      current = def.innerType as ZodTypeAny;
      continue;
    }
    break;
  }
  return { schema: current, optional };
}

function toLabel(key: string): string {
  const words = key
    .replace(/([A-Z])/g, " $1")
    .trim()
    .toLowerCase()
    .split(" ");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Resolves a single field's base kind, or throws UnsupportedConfigFieldError. */
function baseKind(
  fieldKey: string,
  schema: ZodTypeAny,
): {
  kind: Exclude<ConfigFieldKind, "credential">;
  enumValues?: readonly string[];
} {
  const def = defOf(schema);
  switch (def.type) {
    case "string":
      return {
        kind: schema.safeParse(MULTILINE_PROBE).success
          ? "multiline"
          : "string",
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "enum":
      return {
        kind: "enum",
        enumValues: Object.values(
          (def.entries ?? {}) as Record<string, unknown>,
        ) as string[],
      };
    case "record": {
      const keyType = def.keyType as ZodTypeAny;
      const valueType = def.valueType as ZodTypeAny;
      if (
        defOf(keyType).type === "string" &&
        defOf(valueType).type === "string"
      ) {
        return { kind: "kv-list" };
      }
      throw new UnsupportedConfigFieldError(
        fieldKey,
        "is a `z.record` whose value type is not a string; only `z.record(z.string(), z.string())` is supported by the config form",
      );
    }
    case "array": {
      const element = def.element as ZodTypeAny;
      if (defOf(element).type === "object") {
        const shape = ((
          element as ZodTypeAny as { shape?: Record<string, ZodTypeAny> }
        ).shape ?? {}) as Record<string, ZodTypeAny>;
        const keys = Object.keys(shape);
        if (
          keys.length === 2 &&
          defOf(shape.key).type === "string" &&
          defOf(shape.value).type === "string"
        ) {
          return { kind: "keyValueList" };
        }
      }
      throw new UnsupportedConfigFieldError(
        fieldKey,
        "is a `z.array` whose element is not `z.object({ key: z.string(), value: z.string() })`; that shape is the only supported array config field",
      );
    }
    default:
      throw new UnsupportedConfigFieldError(
        fieldKey,
        `uses the Zod type "${String(def.type)}", which the config form does not support`,
      );
  }
}

export function resolveConfigFields(
  configSchema: ZodTypeAny,
  credentials: CredentialRequirement[] = [],
): ResolvedConfigField[] {
  const { schema: root } = unwrap(configSchema);
  if (defOf(root).type !== "object") {
    throw new UnsupportedConfigFieldError(
      "root",
      "configSchema is not a Zod object",
    );
  }

  const shape =
    (root as ZodTypeAny as { shape?: Record<string, ZodTypeAny> }).shape ?? {};

  const fields: ResolvedConfigField[] = [];
  for (const key of Object.keys(shape)) {
    const credential = credentials.find((c) => c.key === key) ?? null;
    const { schema: base, optional } = unwrap(shape[key]);

    if (credential) {
      fields.push({
        key,
        kind: "credential",
        label: toLabel(key),
        optional,
        credential,
      });
      continue;
    }

    const kind = baseKind(key, base);
    fields.push({
      key,
      ...kind,
      label: toLabel(key),
      optional,
      credential: null,
    });
  }
  return fields;
}
