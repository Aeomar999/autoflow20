import { z } from "zod";

/**
 * Per-node-type config schemas (AF-A-04).
 *
 * Posture: fields are optional but strictly typed. Completeness is enforced
 * at execution time by each executor's NonRetriableError checks - the canvas
 * must stay saveable while half-configured. Unknown keys are stripped
 * (Zod default), so arbitrary client-supplied data can no longer reach the
 * database or executors.
 *
 * Template-bearing URL fields (endpoint, webhookUrl) accept Handlebars
 * syntax, so they are length/charset-checked here; the SSRF guard re-checks
 * the rendered value at run time.
 */

/** Identifier-safe variable names usable in templates: {{name.field}} */
export const variableNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Variable name must start with a letter or underscore",
  )
  .max(64);

/** Control characters are never legitimate inside URL templates.
 * Char-code scan instead of a regex so both noControlCharactersInRegex
 * and useRegexLiterals stay satisfied - the ban itself is intentional. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** URL templates accept Handlebars syntax - charset-checked here;
 * SSRF-checked after rendering at run time (egress-guard). */
const urlTemplate = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !hasControlChar(v), "Control characters are not allowed");

const credentialId = () => z.string().cuid().optional();

/** Canvas node ids are client-generated cuid2 - length-bounded, format-free. */
const nodeId = () => z.string().min(1).max(64);

/** Free text may contain newlines (multi-line prompts, messages); only length-capped. */
const freeText = (max: number) => z.string().max(max);

const prompt = () => freeText(100_000).optional();

const triggerData = z.object({}).optional();

const httpRequestData = z.object({
  variableName: variableNameSchema.optional(),
  endpoint: urlTemplate(2048).optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
  body: z.string().max(65_536).optional(),
  timeoutMs: z.number().int().min(250).max(60_000).optional(),
});

const aiModelData = () =>
  z.object({
    variableName: variableNameSchema.optional(),
    credentialId: credentialId(),
    systemPrompt: prompt(),
    userPrompt: prompt(),
  });

const discordData = z.object({
  variableName: variableNameSchema.optional(),
  webhookUrl: urlTemplate(2048).optional(),
  content: freeText(4000).optional(),
  username: freeText(80).optional(),
});

const slackData = z.object({
  variableName: variableNameSchema.optional(),
  webhookUrl: urlTemplate(2048).optional(),
  content: freeText(4000).optional(),
});

const nodePositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/**
 * One variant per NodeType so parse errors carry the offending node's
 * index + field path ("nodes[2].data.endpoint: ..."). The explicit tuple
 * (not Object.entries().map()) keeps each `type` literal distinct, which
 * Zod's discriminatedUnion needs for fast, precise matching.
 */
function makeNodeSchema(type: string, data: z.ZodTypeAny) {
  return z.object({
    id: nodeId(),
    position: nodePositionSchema,
    type: z.literal(type),
    data,
  });
}

export const updateNodeSchemas = [
  makeNodeSchema("INITIAL", triggerData),
  makeNodeSchema("MANUAL_TRIGGER", triggerData),
  makeNodeSchema("GOOGLE_FORM_TRIGGER", triggerData),
  makeNodeSchema("STRIPE_TRIGGER", triggerData),
  makeNodeSchema("HTTP_REQUEST", httpRequestData),
  makeNodeSchema("ANTHROPIC", aiModelData()),
  makeNodeSchema("GEMINI", aiModelData()),
  makeNodeSchema("OPENAI", aiModelData()),
  makeNodeSchema("DISCORD", discordData),
  makeNodeSchema("SLACK", slackData),
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
});

export type SaveWorkflowInput = z.infer<typeof saveWorkflowInputSchema>;
