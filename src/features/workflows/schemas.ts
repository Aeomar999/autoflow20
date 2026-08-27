import { z } from "zod";
import { nodeRegistry } from "@/nodes/registry";
import { variableNameSchema } from "@/nodes/shared/config-fields";

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
  });
}

const configOf = (type: string) => nodeRegistry.resolve(type).configSchema;

export const updateNodeSchemas = [
  makeNodeSchema("INITIAL", configOf("MANUAL_TRIGGER")),
  makeNodeSchema("MANUAL_TRIGGER", configOf("MANUAL_TRIGGER")),
  makeNodeSchema("WEBHOOK_TRIGGER", configOf("WEBHOOK_TRIGGER")),
  makeNodeSchema("SCHEDULE_TRIGGER", configOf("SCHEDULE_TRIGGER")),
  makeNodeSchema("SET", configOf("SET")),
  makeNodeSchema("CONDITION", configOf("CONDITION")),
  makeNodeSchema("MERGE", configOf("MERGE")),
  makeNodeSchema("GOOGLE_FORM_TRIGGER", configOf("GOOGLE_FORM_TRIGGER")),
  makeNodeSchema("STRIPE_TRIGGER", configOf("STRIPE_TRIGGER")),
  makeNodeSchema("HTTP_REQUEST", configOf("HTTP_REQUEST")),
  makeNodeSchema("ANTHROPIC", configOf("ANTHROPIC")),
  makeNodeSchema("GEMINI", configOf("GEMINI")),
  makeNodeSchema("OPENAI", configOf("OPENAI")),
  makeNodeSchema("DISCORD", configOf("DISCORD")),
  makeNodeSchema("SLACK", configOf("SLACK")),
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
