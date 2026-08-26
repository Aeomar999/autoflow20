import { z } from "zod";

/**
 * Shared config-field primitives for node definitions (AF-M1-01).
 *
 * These preserve the exact validation semantics of the AF-A-04 save-boundary
 * schemas — definitions compose them so there is one source of truth per
 * field shape. Posture: fields optional but strictly typed; completeness is
 * enforced at execution time, keeping half-configured graphs saveable.
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
export const urlTemplate = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => !hasControlChar(v), "Control characters are not allowed");

export const credentialIdRef = () => z.string().cuid().optional();

/** Free text may contain newlines (multi-line prompts, messages); only length-capped. */
export const freeText = (max: number) => z.string().max(max);

export const promptSchema = () => freeText(100_000).optional();

/** Trigger nodes carry no config today; data may be absent entirely. */
export const triggerDataSchema = z.object({}).optional();

/** Shared by the three AI provider nodes until `ai.llm` supersedes them (M5). */
export const aiModelDataSchema = () =>
  z.object({
    variableName: variableNameSchema.optional(),
    credentialId: credentialIdRef(),
    systemPrompt: promptSchema(),
    userPrompt: promptSchema(),
  });
