import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";

/**
 * Per-node run policy (AF-M9-06).
 *
 * Before this, the runner read `data._timeoutMs` and `data._continueOnFail` —
 * two keys that appeared in no `configSchema`, no UI, and no documentation.
 * Nothing could set them, nothing validated them, and the save boundary was
 * free to drop them. Meanwhile all three reference workflows AF-M9 targets set
 * `retryOnFail: true, maxRetries: 2` per node, which was simply not expressible.
 *
 * The policy now lives under one reserved key, with a schema, so it is
 * validated at the save boundary and editable in the config panel.
 *
 * Client-safe: schema and pure resolution only, no server imports, so the
 * editor can render and validate it.
 */

/** Reserved key inside `Node.data`. Never a node's own config field. */
export const RUN_POLICY_KEY = "_run" as const;

/**
 * Legacy keys the runner used to read directly. Kept ONLY as a read fallback.
 *
 * No migration ships with AF-M9-06, and that is a deliberate call rather than
 * an omission: these keys were never written by the editor, by a template, or
 * by the public API — the only writers in the repo's history are engine test
 * fixtures. A data migration would therefore be dead code, and "grep the
 * database" is exactly the check AF-M8-12 got burned by (it only ever covers
 * the database you happen to point at). Reading them costs four lines and
 * cannot be wrong; migrating rows that provably do not exist can be.
 */
export const LEGACY_TIMEOUT_KEY = "_timeoutMs" as const;
export const LEGACY_CONTINUE_ON_FAIL_KEY = "_continueOnFail" as const;

/** Hard bounds. A node may not opt out of being bounded (property P5). */
export const MIN_TIMEOUT_MS = 250;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_ATTEMPTS = 5;

export const runPolicySchema = z.object({
  /** Total attempts including the first. 1 = no retry. */
  maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS).optional(),
  /** Base for exponential backoff between attempts. */
  backoffMs: z.number().int().min(0).max(60_000).optional(),
  /** Wall-clock cap for ONE attempt. */
  timeoutMs: z
    .number()
    .int()
    .min(MIN_TIMEOUT_MS)
    .max(MAX_TIMEOUT_MS)
    .optional(),
  /** When true, a failed node is recorded FAILED but the run continues. */
  continueOnFail: z.boolean().optional(),
});

export type RunPolicy = z.infer<typeof runPolicySchema>;

/** The fully-resolved policy the runner executes with. */
export interface ResolvedRunPolicy {
  maxAttempts: number;
  backoffMs: number;
  timeoutMs: number;
  continueOnFail: boolean;
}

/** Engine-wide fallbacks, supplied by the runner so this module stays pure. */
export interface RunPolicyDefaults {
  maxAttempts: number;
  backoffMs: number;
  timeoutMs: number;
}

/** Read `_run` off a node's data, or `undefined` when absent/malformed. */
export function readRunPolicy(
  data: Record<string, unknown> | null | undefined,
): RunPolicy | undefined {
  const raw = data?.[RUN_POLICY_KEY];
  if (raw === undefined || raw === null) return undefined;
  const parsed = runPolicySchema.safeParse(raw);
  // A malformed policy is reported by `validate()` at the save boundary; here
  // it degrades to the definition/engine defaults rather than failing the run,
  // because refusing to execute over a bad retry count would be worse than
  // executing with the standard one.
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolve the policy for one node.
 *
 * Precedence, highest first:
 *   1. the node's `_run` policy
 *   2. the legacy `_timeoutMs` / `_continueOnFail` keys (read-only, see above)
 *   3. `definition.defaultRetry` / `definition.timeoutMs`
 *   4. the engine defaults
 */
export function resolveRunPolicy(
  data: Record<string, unknown> | null | undefined,
  definition: Pick<NodeDefinition, "defaultRetry" | "timeoutMs">,
  defaults: RunPolicyDefaults,
): ResolvedRunPolicy {
  const policy = readRunPolicy(data);

  const legacyTimeout = data?.[LEGACY_TIMEOUT_KEY];
  const legacyContinue = data?.[LEGACY_CONTINUE_ON_FAIL_KEY];

  const timeoutMs =
    policy?.timeoutMs ??
    (typeof legacyTimeout === "number" && legacyTimeout > 0
      ? legacyTimeout
      : undefined) ??
    definition.timeoutMs ??
    defaults.timeoutMs;

  return {
    maxAttempts:
      policy?.maxAttempts ??
      definition.defaultRetry?.maxAttempts ??
      defaults.maxAttempts,
    backoffMs:
      policy?.backoffMs ??
      definition.defaultRetry?.backoffMs ??
      defaults.backoffMs,
    // Clamped, not rejected: a saved node predating the bounds must still run.
    timeoutMs: Math.min(Math.max(timeoutMs, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS),
    continueOnFail:
      policy?.continueOnFail ??
      (typeof legacyContinue === "boolean" ? legacyContinue : false),
  };
}
