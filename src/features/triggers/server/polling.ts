import "server-only";
import type { PollItem, PollingTrigger, PollResult } from "@/nodes/types";

/**
 * The polling-trigger framework (AF-M10-05, ADR-0024).
 *
 * A poller answers one question — "given where we left off, what is new?" —
 * and the framework does everything else: deciding whose turn it is, resolving
 * credentials, suppressing what was already dispatched, persisting the cursor,
 * and backing off a provider that keeps failing.
 *
 * This module is the pure core. It has no Prisma and no Inngest imports so the
 * decisions are testable without a database or a job runner; `polling-sweep.ts`
 * binds it to both.
 */

/** Sweep cadence. Nothing can be polled faster than the job that polls it. */
export const MIN_POLL_INTERVAL_SECONDS = 60;

/** Fallback when neither the node config nor the poller states an interval. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 300;

/**
 * Ids remembered per trigger.
 *
 * Providers answer "changed since T" inclusively, so consecutive polls
 * overlap — usually by one or two items, occasionally by a whole page when a
 * batch shares a timestamp. 500 covers that with room to spare and keeps the
 * row small enough to read on every sweep.
 */
export const SEEN_ID_WINDOW = 500;

/** Items one poll may dispatch. A backlog drains over several sweeps. */
export const MAX_ITEMS_PER_POLL = 50;

/**
 * Pollers a single sweep will run. The sweep is one minute long and each poll
 * is a network round trip; without a ceiling, one org with 500 triggers
 * starves everyone else's.
 */
export const MAX_POLLS_PER_SWEEP = 200;

/** Backoff ceiling: a persistently broken trigger is retried hourly, not never. */
export const MAX_BACKOFF_SECONDS = 3600;

export interface TriggerStateSnapshot {
  cursor: unknown;
  lastSeenIds: string[];
  lastPolledAt: Date | null;
  failureCount: number;
  nextPollAt: Date | null;
  keyFingerprint: string | null;
}

export interface PollableTrigger {
  workflowId: string;
  organizationId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  config: Record<string, unknown>;
  intervalSeconds: number;
}

/**
 * Is this trigger due?
 *
 * Three gates, in order of how badly getting them wrong hurts:
 *  - a backoff window set by a previous failure is absolute;
 *  - a trigger never polled is always due (that first poll is what establishes
 *    the cursor);
 *  - otherwise, the configured interval since the last poll.
 */
export function isPollDue(
  trigger: PollableTrigger,
  state: TriggerStateSnapshot | null,
  now: Date,
): boolean {
  if (!state) {
    return true;
  }
  if (state.nextPollAt && state.nextPollAt.getTime() > now.getTime()) {
    return false;
  }
  if (!state.lastPolledAt) {
    return true;
  }
  const elapsedMs = now.getTime() - state.lastPolledAt.getTime();
  return elapsedMs >= trigger.intervalSeconds * 1000;
}

/** Clamp a configured interval to something the sweep can actually honour. */
export function normalizeInterval(seconds: unknown): number {
  const value =
    typeof seconds === "number" && Number.isFinite(seconds)
      ? seconds
      : typeof seconds === "string"
        ? Number.parseInt(seconds, 10)
        : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
  return Math.max(Math.floor(value), MIN_POLL_INTERVAL_SECONDS);
}

/** Exponential backoff after `failureCount` consecutive failures. */
export function backoffSeconds(
  failureCount: number,
  intervalSeconds: number,
): number {
  const factor = 2 ** Math.min(failureCount, 10);
  return Math.min(intervalSeconds * factor, MAX_BACKOFF_SECONDS);
}

export interface PollOutcome {
  /** Items to dispatch as runs. Empty on a first poll, by design. */
  dispatch: PollItem[];
  /** The state to persist. */
  nextState: {
    cursor: unknown;
    lastSeenIds: string[];
    lastPolledAt: Date;
    failureCount: number;
    lastError: string | null;
    nextPollAt: Date | null;
    keyFingerprint: string | null;
  };
  /** Set when the poll failed; the caller logs it and records the backoff. */
  error?: string;
}

/**
 * Run one poll and decide what it means.
 *
 * Everything that makes at-least-once delivery survivable lives here:
 *
 * **No history replay.** A trigger with no prior state records the cursor and
 * the ids it saw and dispatches nothing. Activating a workflow against a
 * 500-row sheet must start zero runs; the alternative — 500 runs the moment a
 * user clicks Publish — is the kind of thing people find out about from their
 * provider's rate limiter.
 *
 * **Dedupe by id, not by cursor.** A cursor alone is not enough: providers
 * answer "since T" inclusively, and a poll that fails after dispatching but
 * before persisting is retried from the same cursor. The id window is what
 * makes both cases safe.
 *
 * **A failing poll changes nothing but the backoff.** The cursor and the id
 * window are left exactly as they were, so a provider outage costs a delay,
 * never a gap in what gets processed.
 */
export async function runPoll(args: {
  trigger: PollableTrigger;
  poller: PollingTrigger;
  state: TriggerStateSnapshot | null;
  credentials?: Record<string, Record<string, string>>;
  keyFingerprint?: string | null;
  now: Date;
}): Promise<PollOutcome> {
  const { trigger, poller, state, credentials, now } = args;
  const keyFingerprint = args.keyFingerprint ?? null;

  // A changed key expression means the stored ids answer a different question.
  // Keeping them would suppress items the new key has never seen.
  const fingerprintChanged =
    state !== null &&
    keyFingerprint !== null &&
    state.keyFingerprint !== null &&
    state.keyFingerprint !== keyFingerprint;

  const isFirstPoll = state === null || state.lastPolledAt === null;
  const seen = new Set(fingerprintChanged ? [] : (state?.lastSeenIds ?? []));

  let result: PollResult;
  try {
    result = await poller.poll({
      config: trigger.config,
      credentials,
      cursor: fingerprintChanged ? undefined : state?.cursor,
      isFirstPoll,
      limit: MAX_ITEMS_PER_POLL,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureCount = (state?.failureCount ?? 0) + 1;
    return {
      dispatch: [],
      nextState: {
        // Cursor and window are carried forward untouched: a provider outage
        // must cost a delay, not a hole in what gets processed.
        cursor: state?.cursor,
        lastSeenIds: state?.lastSeenIds ?? [],
        lastPolledAt: now,
        failureCount,
        lastError: message.slice(0, 1000),
        nextPollAt: new Date(
          now.getTime() +
            backoffSeconds(failureCount, trigger.intervalSeconds) * 1000,
        ),
        keyFingerprint,
      },
      error: message,
    };
  }

  const items = (result.items ?? []).filter(
    (item): item is PollItem =>
      Boolean(item) && typeof item.id === "string" && item.id.length > 0,
  );

  // Within one poll a provider can repeat an id (paging over a moving window).
  const fresh: PollItem[] = [];
  const batchIds = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id) || batchIds.has(item.id)) {
      continue;
    }
    batchIds.add(item.id);
    fresh.push(item);
    if (fresh.length >= MAX_ITEMS_PER_POLL) {
      break;
    }
  }

  // The first poll establishes the baseline. Its ids are remembered so the
  // next poll does not report them as new, but nothing is dispatched.
  const dispatch = isFirstPoll ? [] : fresh;

  const nextSeen = [...seen, ...fresh.map((item) => item.id)].slice(
    -SEEN_ID_WINDOW,
  );

  return {
    dispatch,
    nextState: {
      cursor: result.cursor,
      lastSeenIds: nextSeen,
      lastPolledAt: now,
      failureCount: 0,
      lastError: null,
      nextPollAt: null,
      keyFingerprint,
    },
  };
}
