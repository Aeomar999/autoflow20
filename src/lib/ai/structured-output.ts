/**
 * Making a user-supplied JSON schema acceptable to OpenAI structured outputs.
 *
 * The AI SDK sends `response_format: {type: "json_schema", json_schema:
 * {name: "response", strict: …}}`, and its `strictJsonSchema` option defaults
 * to **true**. Strict mode is far narrower than JSON Schema: every object must
 * carry `additionalProperties: false`, and every declared property must appear
 * in `required` — it cannot express an optional property at all. A schema that
 * breaks either rule is rejected outright, before the model is even asked:
 *
 *     Invalid schema for response_format 'response': In context=(),
 *     'additionalProperties' is required to be supplied and to be false.
 *
 * Both AI nodes let the user paste a schema and handed it to the provider
 * exactly as typed, so any schema written to ordinary JSON Schema rules failed
 * every run. Nothing local caught it: the shape is only rejected by OpenAI.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `type` may be a single name or a union like `["object", "null"]`. */
const declaresObject = (type: unknown): boolean =>
  Array.isArray(type) ? type.includes("object") : type === "object";

/** Keys whose value maps names to schemas — walked, but not schemas itself. */
const SCHEMA_MAPS = ["properties", "$defs", "definitions"] as const;

/** Keys whose value is a list of schemas. */
const SCHEMA_LISTS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;

const mapValues = (
  source: Record<string, unknown>,
  transform: (value: unknown) => unknown,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, transform(value)]),
  );

/** The sub-schemas reachable from one schema node. */
function childSchemas(node: Record<string, unknown>): unknown[] {
  const children: unknown[] = [];
  for (const key of SCHEMA_MAPS) {
    const value = node[key];
    if (isPlainObject(value)) children.push(...Object.values(value));
  }
  for (const key of SCHEMA_LISTS) {
    const value = node[key];
    if (Array.isArray(value)) children.push(...value);
  }
  if (node.items !== undefined) {
    children.push(...(Array.isArray(node.items) ? node.items : [node.items]));
  }
  return children;
}

/**
 * Add `additionalProperties: false` to every object in a JSON schema.
 *
 * This cannot change what a schema means for these nodes: both already
 * promise the model returns exactly the requested shape, so sealing is that
 * promise applied at every depth rather than only at the root, which is as
 * far as the field-list builder went.
 *
 * An explicit `additionalProperties` is left alone. Someone who wrote one
 * meant it, and `isStrictCompatible` reacts to it instead of overwriting it.
 */
export function sealObjectSchemas(node: unknown): unknown {
  if (!isPlainObject(node)) return node;

  const schema: Record<string, unknown> = { ...node };

  for (const key of SCHEMA_MAPS) {
    const value = schema[key];
    if (isPlainObject(value)) schema[key] = mapValues(value, sealObjectSchemas);
  }
  for (const key of SCHEMA_LISTS) {
    const value = schema[key];
    if (Array.isArray(value)) schema[key] = value.map(sealObjectSchemas);
  }
  if (schema.items !== undefined) {
    schema.items = Array.isArray(schema.items)
      ? schema.items.map(sealObjectSchemas)
      : sealObjectSchemas(schema.items);
  }

  if (
    declaresObject(schema.type) &&
    schema.additionalProperties === undefined
  ) {
    schema.additionalProperties = false;
  }
  return schema;
}

/**
 * Whether OpenAI will accept this schema under `strict: true`.
 *
 * `sealObjectSchemas` has already supplied the `additionalProperties` half.
 * What remains is the `required` half, and that one is deliberately *not*
 * fixed up: adding a property to `required` tells the model it must return a
 * value for it, and both nodes instruct the model not to invent values that
 * are not in the source. Satisfying the API that way would buy a schema
 * guarantee by asking for fabricated data.
 *
 * So a schema that cannot be accepted as written runs with strict mode off
 * instead — see `strictModeProviderOptions`. The model still receives the
 * schema, and the SDK still validates the result against it; what is lost is
 * the provider-side guarantee, which is the honest price of honouring an
 * optional field.
 */
export function isStrictCompatible(node: unknown): boolean {
  if (!isPlainObject(node)) return true;

  if (declaresObject(node.type)) {
    if (node.additionalProperties !== false) return false;

    const properties = isPlainObject(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required) ? node.required : [];
    if (Object.keys(properties).some((name) => !required.includes(name))) {
      return false;
    }
  }

  return childSchemas(node).every(isStrictCompatible);
}

/**
 * Provider options for a schema, or `undefined` when the default (strict)
 * behaviour is right. The `openai` key is ignored by the other adapters.
 */
export function strictModeProviderOptions(
  schema: unknown,
): { openai: { strictJsonSchema: false } } | undefined {
  return isStrictCompatible(schema)
    ? undefined
    : { openai: { strictJsonSchema: false } };
}
