import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Workspace-scoped AI response cache (AF-M5-07).
 *
 * A node opts in by configuring a TTL. The key is a fingerprint of everything
 * that can change the answer — node type, the model chain, the compiled
 * prompts, and the call parameters — so a config edit misses rather than
 * serving a stale answer for the old prompt. The workspace id is part of the
 * lookup, never just part of the hash: one tenant's entry is unreachable from
 * another tenant's query (engineering_rules §1.3).
 *
 * Cached runs record ZERO tokens and ZERO cost, because nothing was purchased.
 * The spend the cache avoided is `hitCount * costUsd` on the entry itself,
 * which is what `cacheStats` reports.
 */

/** Ceiling for a configured TTL: 7 days. */
export const AI_CACHE_MAX_TTL_SECONDS = 604_800;

/** Everything that can change a model's answer. Order-insensitive by design. */
export interface AiCacheRequest {
  /** Node type id, so two node types never collide on identical prompts. */
  nodeType: string;
  /** Ordered candidate model chain — a different chain can serve differently. */
  candidates: readonly string[];
  /** Compiled system prompt, when the node sends one. */
  system?: string;
  /** Compiled user prompt / source content. */
  prompt: string;
  /** Call parameters and output schema that shape the response. */
  params?: Record<string, unknown>;
}

export interface AiCacheScope {
  organizationId: string;
  cacheKey: string;
}

export interface AiCacheEntry {
  value: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Stable JSON: object keys are sorted at every depth so two structurally equal
 * requests hash identically regardless of key insertion order. `undefined`
 * members are dropped, matching JSON.stringify's object behaviour.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

/** sha256 fingerprint of a request envelope. Pure — safe to unit test. */
export function buildAiCacheKey(request: AiCacheRequest): string {
  const envelope = canonicalize({
    nodeType: request.nodeType,
    candidates: [...request.candidates],
    system: request.system ?? "",
    prompt: request.prompt,
    params: request.params ?? {},
  });
  return createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
}

/**
 * Normalizes a node's configured TTL. Anything absent, non-numeric, or <= 0
 * means "cache disabled"; longer than the ceiling is clamped rather than
 * rejected, so a typo cannot pin an answer in place indefinitely.
 */
export function normalizeCacheTtlSeconds(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(Math.floor(raw), AI_CACHE_MAX_TTL_SECONDS);
}

/**
 * Reads a live entry for this workspace and counts the hit. Returns null on a
 * miss, on an expired entry, or when the stored payload is unreadable.
 *
 * A cache read must never fail a run: read errors are logged and treated as a
 * miss so the node falls through to the provider.
 */
export async function readAiCache(
  scope: AiCacheScope,
  now: Date = new Date(),
): Promise<AiCacheEntry | null> {
  try {
    const row = await prisma.aiResponseCache.findFirst({
      where: {
        organizationId: scope.organizationId,
        cacheKey: scope.cacheKey,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        response: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
      },
    });

    if (!row) {
      return null;
    }

    const stored = row.response as { value?: unknown } | null;
    if (!stored || typeof stored !== "object" || !("value" in stored)) {
      logger.warn(
        "AI cache entry has an unreadable payload; treating as miss",
        {
          cacheKey: scope.cacheKey,
          organizationId: scope.organizationId,
        },
      );
      return null;
    }

    await prisma.aiResponseCache.update({
      where: { id: row.id },
      data: { hitCount: { increment: 1 }, lastHitAt: now },
    });

    return {
      value: stored.value,
      model: row.model,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      costUsd: row.costUsd,
    };
  } catch (error) {
    // Ignorable by design: a cache outage degrades to a provider call, which
    // is correct but more expensive. Logged so the degradation is visible.
    logger.warn("AI cache read failed; falling through to the provider", {
      error,
      organizationId: scope.organizationId,
    });
    return null;
  }
}

export interface AiCacheWrite extends AiCacheScope {
  nodeType: string;
  model: string;
  value: unknown;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  ttlSeconds: number;
}

/**
 * Stores (or refreshes) an entry. Writing resets `hitCount` because the entry
 * is a new answer, not a continuation of the previous one.
 *
 * Like reads, a write failure never fails the run — the answer is already in
 * hand and the caller must not lose it to a cache problem.
 */
export async function writeAiCache(
  write: AiCacheWrite,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + write.ttlSeconds * 1000);
  const payload = { value: write.value } as Prisma.InputJsonValue;

  try {
    await prisma.aiResponseCache.upsert({
      where: {
        organizationId_cacheKey: {
          organizationId: write.organizationId,
          cacheKey: write.cacheKey,
        },
      },
      create: {
        organizationId: write.organizationId,
        cacheKey: write.cacheKey,
        nodeType: write.nodeType,
        model: write.model,
        response: payload,
        tokensIn: write.tokensIn,
        tokensOut: write.tokensOut,
        costUsd: write.costUsd,
        expiresAt,
      },
      update: {
        nodeType: write.nodeType,
        model: write.model,
        response: payload,
        tokensIn: write.tokensIn,
        tokensOut: write.tokensOut,
        costUsd: write.costUsd,
        hitCount: 0,
        lastHitAt: null,
        expiresAt,
      },
    });
  } catch (error) {
    logger.warn("AI cache write failed; the response was still returned", {
      error,
      organizationId: write.organizationId,
    });
  }
}

/** Deletes every expired entry. Called by the daily sweep. */
export async function purgeExpiredAiCache(
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.aiResponseCache.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return count;
}
