import {
  type ApiKeyScope,
  KNOWN_API_KEY_SCOPES,
  parseScopes,
} from "@/features/api-keys/lib/key";

/**
 * Public API field-level serializers (AF-M8-01).
 *
 * The public surface speaks `snake_case`; the internal models are `camelCase`.
 * Mapping is done HERE, explicitly and per-field, so internal field names never
 * leak through the boundary (`docs/architecture/api_contract.md` §5). Date
 * values become ISO-8601 strings; Prisma `Decimal` costs become plain numbers.
 *
 * Pure + isomorphic so the mapping is unit-testable without a DB.
 */

export interface PublicWorkflow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface PublicExecution {
  id: string;
  workflow_id: string;
  status: string;
  trigger: string;
  mode: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error: string | null;
}

export function serializeWorkflow(input: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}): PublicWorkflow {
  return {
    id: input.id,
    name: input.name,
    created_at: input.createdAt.toISOString(),
    updated_at: input.updatedAt.toISOString(),
  };
}

export function serializeExecution(input: {
  id: string;
  workflowId: string;
  status: string;
  trigger: string;
  mode: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  tokensIn: number;
  tokensOut: number;
  /** A Prisma Decimal (AF-M8-11) or a plain number; always emitted as a number. */
  costUsd: number | { toNumber(): number };
  error: string | null;
}): PublicExecution {
  return {
    id: input.id,
    workflow_id: input.workflowId,
    status: input.status,
    trigger: input.trigger,
    mode: input.mode,
    started_at: input.startedAt.toISOString(),
    completed_at: input.completedAt?.toISOString() ?? null,
    duration_ms: input.durationMs,
    tokens_in: input.tokensIn,
    tokens_out: input.tokensOut,
    cost_usd: Number(input.costUsd),
    error: input.error,
  };
}

/** Scope list for a key's management response, sorted. */
export function serializeScopesList(rawScopes: string): ApiKeyScope[] {
  const known = parseScopes(rawScopes).filter((s): s is ApiKeyScope =>
    (KNOWN_API_KEY_SCOPES as readonly string[]).includes(s),
  );
  return known.sort();
}
