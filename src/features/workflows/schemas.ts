import { z } from "zod";
import { nodeRegistry } from "@/nodes/registry";
import { variableNameSchema } from "@/nodes/shared/config-fields";
import { RUN_POLICY_KEY, runPolicySchema } from "@/nodes/shared/run-policy";

/**
 * Save-boundary validation (AF-A-04), rebuilt on the node registry (AF-M1-01).
 *
 * Each entry's `data` schema now comes from that node's `definition.configSchema`
 * in src/nodes/** - one source of truth shared by the save boundary, the
 * config panel, and the engine. The explicit tuples below keep each `type`
 * literal distinct for Zod's discriminatedUnion and preserve the original
 * variant order; "INITIAL" remains an explicit alias of the manual trigger's
 * schema until M1-02 migrates persisted rows.
 *
 * Posture unchanged: fields optional but strictly typed; completeness enforced
 * at execution time; unknown keys stripped; URL templates charset-checked here
 * and SSRF-checked after rendering at run time.
 */

const nodeId = () => z.string().min(1).max(64);

const nodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

function makeNodeSchema(type: string, data: z.ZodTypeAny) {
  return z.object({
    id: nodeId(),
    position: nodePositionSchema,
    type: z.literal(type),
    data,
    name: z.string().min(1).max(50).optional(),
    notes: z.string().max(500).optional(),
    disabled: z.boolean().optional(),
  });
}

/**
 * A node's `data` schema at the save boundary: its own `configSchema`, plus
 * the reserved AF-M9-06 run-policy key.
 *
 * **This is a bug fix, not a refactor.** `configSchema` is a plain Zod object,
 * and Zod strips unknown keys — so `_run` was silently discarded on every
 * save. A user who set retries or a timeout in the config panel watched the
 * setting vanish the moment they saved, and all three M9 reference templates
 * shipped `_run` that never survived installation.
 *
 * That is precisely the failure AF-M9-06 was written to end: its own note
 * says the legacy `_timeoutMs`/`_continueOnFail` keys were broken because
 * they "appeared in no configSchema" and "the save boundary was free to drop
 * them". The task added the schema, the runner support and the UI, but not
 * this — so the key it introduced was dropped the same way. Found by the
 * AF-M9-15 round-trip proof.
 *
 * Implemented as a transform rather than `configSchema.extend(...)` because
 * not every node's schema is a bare `ZodObject`: `triggerDataSchema` is
 * `z.object({}).optional()` and `AGGREGATE`'s is `z.object({}).default({})`,
 * neither of which exposes `.extend`. Splitting the key off, validating both
 * halves, and re-joining works for every shape and keeps each half's error
 * messages pointing at the right field.
 *
 * Legacy `_timeoutMs`/`_continueOnFail` are deliberately NOT preserved here.
 * `run-policy.ts` keeps reading them so any fixture that still sets them runs,
 * but nothing in the product has ever written them, so persisting them through
 * a save would be inventing a migration path for data that does not exist.
 */
const configOf = (type: string) => {
  const config = nodeRegistry.resolve(type).configSchema;

  return z.unknown().transform((raw, ctx) => {
    const input =
      raw !== null && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    const { [RUN_POLICY_KEY]: rawPolicy, ...rest } = input;

    const parsedConfig = config.safeParse(rest);
    if (!parsedConfig.success) {
      for (const issue of parsedConfig.error.issues) {
        ctx.addIssue({ ...issue, path: [...(issue.path ?? [])] });
      }
      return z.NEVER;
    }

    if (rawPolicy === undefined) {
      return parsedConfig.data;
    }

    const parsedPolicy = runPolicySchema.safeParse(rawPolicy);
    if (!parsedPolicy.success) {
      for (const issue of parsedPolicy.error.issues) {
        ctx.addIssue({
          ...issue,
          path: [RUN_POLICY_KEY, ...(issue.path ?? [])],
        });
      }
      return z.NEVER;
    }

    return {
      ...(parsedConfig.data as Record<string, unknown>),
      [RUN_POLICY_KEY]: parsedPolicy.data,
    };
  });
};

/**
 * The saveable node types.
 *
 * Hand-written rather than derived, because `makeNodeSchema` needs a LITERAL
 * type per entry for `z.discriminatedUnion` to keep its discriminant - mapping
 * over the manifest would collapse every `z.literal(type)` to
 * `ZodLiteral<string>` and lose that. The cost of hand-writing it is drift,
 * and drift here is not cosmetic:
 *
 * - A registered type missing from this list **cannot be saved**. That was the
 *   state of `AI_LLM` and `AI_EXTRACT` until AF-M8-24: both shipped in M5,
 *   both sat in the palette, and neither could be persisted, because this
 *   input schema rejected them before the handler ran.
 * - A deleted type still listed here throws `UnknownNodeTypeError` at import,
 *   which is what AF-M8-12 did to `ANTHROPIC`/`GEMINI`/`OPENAI`.
 *
 * `schemas.test.ts` therefore asserts this list matches the registry exactly,
 * so either kind of drift fails the build with a message naming the type
 * instead of surfacing as a save that mysteriously does not work.
 */

export const updateNodeSchemas = [
  makeNodeSchema("INITIAL", configOf("MANUAL_TRIGGER")),
  makeNodeSchema("MANUAL_TRIGGER", configOf("MANUAL_TRIGGER")),
  makeNodeSchema("WEBHOOK_TRIGGER", configOf("WEBHOOK_TRIGGER")),
  makeNodeSchema("SCHEDULE_TRIGGER", configOf("SCHEDULE_TRIGGER")),
  makeNodeSchema("SET", configOf("SET")),
  makeNodeSchema("CONDITION", configOf("CONDITION")),
  makeNodeSchema("SWITCH", configOf("SWITCH")),
  makeNodeSchema("MERGE", configOf("MERGE")),
  makeNodeSchema("CODE", configOf("CODE")),
  makeNodeSchema("SPLIT_OUT", configOf("SPLIT_OUT")),
  makeNodeSchema("AGGREGATE", configOf("AGGREGATE")),
  makeNodeSchema("RESPOND_TO_WEBHOOK", configOf("RESPOND_TO_WEBHOOK")),
  makeNodeSchema("GOOGLE_FORM_TRIGGER", configOf("GOOGLE_FORM_TRIGGER")),
  makeNodeSchema("FORM_TRIGGER", configOf("FORM_TRIGGER")),
  makeNodeSchema("STRIPE_TRIGGER", configOf("STRIPE_TRIGGER")),
  makeNodeSchema("HTTP_REQUEST", configOf("HTTP_REQUEST")),
  makeNodeSchema("FILE_DOWNLOAD", configOf("FILE_DOWNLOAD")),
  makeNodeSchema("EXTRACT_DOCUMENT_TEXT", configOf("EXTRACT_DOCUMENT_TEXT")),
  makeNodeSchema("FILTER", configOf("FILTER")),
  makeNodeSchema("DEDUPE", configOf("DEDUPE")),
  makeNodeSchema("WAIT", configOf("WAIT")),
  makeNodeSchema("APPROVAL", configOf("APPROVAL")),
  makeNodeSchema("HTML_TO_PDF", configOf("HTML_TO_PDF")),
  makeNodeSchema("DISCORD", configOf("DISCORD")),
  makeNodeSchema("SLACK", configOf("SLACK")),
  makeNodeSchema("EMAIL_SEND", configOf("EMAIL_SEND")),
  makeNodeSchema("WEBHOOK_OUT", configOf("WEBHOOK_OUT")),
  makeNodeSchema("GOOGLE_SHEETS_APPEND", configOf("GOOGLE_SHEETS_APPEND")),
  makeNodeSchema("SHEETS_READ", configOf("SHEETS_READ")),
  makeNodeSchema("SHEETS_UPDATE", configOf("SHEETS_UPDATE")),
  makeNodeSchema("SHEETS_UPSERT", configOf("SHEETS_UPSERT")),
  makeNodeSchema("SHEETS_TRIGGER", configOf("SHEETS_TRIGGER")),
  makeNodeSchema("AIRTABLE_CREATE_RECORD", configOf("AIRTABLE_CREATE_RECORD")),
  makeNodeSchema("HUBSPOT_CREATE_CONTACT", configOf("HUBSPOT_CREATE_CONTACT")),
  makeNodeSchema("POSTGRES_QUERY", configOf("POSTGRES_QUERY")),
  makeNodeSchema("OPENAI_COMPATIBLE_CHAT", configOf("OPENAI_COMPATIBLE_CHAT")),
  makeNodeSchema("AI_RETRIEVE", configOf("AI_RETRIEVE")),
  makeNodeSchema("AI_LLM", configOf("AI_LLM")),
  makeNodeSchema("AI_EXTRACT", configOf("AI_EXTRACT")),
] as const;

export const saveWorkflowInputSchema = z.object({
  id: z.string().min(1).max(64),
  nodes: z.array(z.discriminatedUnion("type", updateNodeSchemas)),
  edges: z.array(
    z.object({
      source: nodeId(),
      target: nodeId(),
      sourceHandle: z.string().max(128).nullish(),
      targetHandle: z.string().max(128).nullish(),
    }),
  ),
  revision: z.number().int().min(0),
});

export type SaveWorkflowInput = z.infer<typeof saveWorkflowInputSchema>;
export { variableNameSchema };
