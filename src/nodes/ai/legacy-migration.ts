import { configSchema as llmConfigSchema } from "./llm/definition";

/**
 * Config mapping for the retired per-provider AI nodes (AF-M5-09).
 *
 * `OPENAI`, `ANTHROPIC`, and `GEMINI` were the tutorial's one-model-per-node
 * executors. `AI_LLM` supersedes all three, so persisted nodes are rewritten
 * onto it rather than left on a type nobody can add any more.
 *
 * Isomorphic and pure: the mapping is unit-tested here and applied by
 * `scripts/migrate-legacy-ai-nodes.ts`, which owns all the database work.
 * See ADR 0011.
 */

export const LEGACY_AI_NODE_TYPES = ["OPENAI", "ANTHROPIC", "GEMINI"] as const;
export type LegacyAiNodeType = (typeof LEGACY_AI_NODE_TYPES)[number];

/** The AI_LLM type id every legacy node migrates onto. */
export const LEGACY_AI_REPLACEMENT_TYPE = "AI_LLM";

/**
 * Model each legacy node is rewritten to, and the credential field that
 * carries its key on AI_LLM.
 *
 * These are NOT the model ids the old executors hard-coded: `gpt-4`,
 * `claude-sonnet-4-5`, and `gemini-2.0-flash` are not in the provider registry
 * (`src/lib/ai/registry.ts`), so pricing and cost capture would be impossible
 * for them. Each maps to the nearest registered model of the same provider,
 * which is a deliberate, reported behaviour change — the script prints every
 * substitution it makes.
 */
export const LEGACY_AI_NODE_MAP: Record<
  LegacyAiNodeType,
  { model: string; credentialField: string; previousModel: string }
> = {
  OPENAI: {
    model: "openai:gpt-4o",
    credentialField: "openaiCredentialId",
    previousModel: "gpt-4",
  },
  ANTHROPIC: {
    model: "anthropic:claude-3-5-sonnet",
    credentialField: "anthropicCredentialId",
    previousModel: "claude-sonnet-4-5",
  },
  GEMINI: {
    model: "google:gemini-1.5-flash",
    credentialField: "geminiCredentialId",
    previousModel: "gemini-2.0-flash",
  },
};

export function isLegacyAiNodeType(type: string): type is LegacyAiNodeType {
  return (LEGACY_AI_NODE_TYPES as readonly string[]).includes(type);
}

export interface LegacyAiNodeMigrationResult {
  type: typeof LEGACY_AI_REPLACEMENT_TYPE;
  data: Record<string, unknown>;
  /** Model the node used to run, for the migration report. */
  previousModel: string;
  /**
   * Keys present on the old node that AI_LLM does not declare. Reported
   * rather than carried: reading an undeclared config key is a bug
   * (engineering_rules §8), and silently dropping data is worse.
   */
  droppedKeys: string[];
}

export class LegacyAiNodeMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyAiNodeMigrationError";
  }
}

/**
 * Rewrites one legacy node's config onto AI_LLM. Engine-level keys
 * (`_timeoutMs`, `_continueOnFail`) are preserved verbatim — they are read by
 * the runner, not by the node's schema.
 */
export function migrateLegacyAiNode(
  type: string,
  rawData: unknown,
): LegacyAiNodeMigrationResult {
  if (!isLegacyAiNodeType(type)) {
    throw new LegacyAiNodeMigrationError(
      `"${type}" is not a retired AI node type. Known: ${LEGACY_AI_NODE_TYPES.join(", ")}`,
    );
  }

  const mapping = LEGACY_AI_NODE_MAP[type];
  const data =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {};

  const carried = new Set([
    "variableName",
    "credentialId",
    "systemPrompt",
    "userPrompt",
  ]);
  const droppedKeys = Object.keys(data)
    .filter((key) => !carried.has(key) && !key.startsWith("_"))
    .sort();

  const migrated: Record<string, unknown> = {
    model: mapping.model,
    temperature: 0.7,
    jsonMode: false,
  };

  if (typeof data.variableName === "string") {
    migrated.variableName = data.variableName;
  }
  if (typeof data.credentialId === "string") {
    migrated[mapping.credentialField] = data.credentialId;
  }
  if (typeof data.systemPrompt === "string") {
    migrated.systemPrompt = data.systemPrompt;
  }
  if (typeof data.userPrompt === "string") {
    migrated.userPrompt = data.userPrompt;
  }
  for (const key of Object.keys(data)) {
    if (key.startsWith("_")) {
      migrated[key] = data[key];
    }
  }

  const parsed = llmConfigSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new LegacyAiNodeMigrationError(
      `migrated config is not valid AI_LLM config: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return {
    type: LEGACY_AI_REPLACEMENT_TYPE,
    data: migrated,
    previousModel: mapping.previousModel,
    droppedKeys,
  };
}
