import { describe, expect, it, vi } from "vitest";
import type { PollItem, PollingTrigger } from "@/nodes/types";
import {
  backoffSeconds,
  DEFAULT_POLL_INTERVAL_SECONDS,
  isPollDue,
  MAX_BACKOFF_SECONDS,
  MAX_ITEMS_PER_POLL,
  MIN_POLL_INTERVAL_SECONDS,
  normalizeInterval,
  type PollableTrigger,
  runPoll,
  SEEN_ID_WINDOW,
  type TriggerStateSnapshot,
} from "./polling";

const NOW = new Date("2026-09-03T12:00:00.000Z");

const trigger = (over: Partial<PollableTrigger> = {}): PollableTrigger => ({
  workflowId: "wf_1",
  organizationId: "org_1",
  nodeId: "node_1",
  nodeType: "SHEETS_TRIGGER",
  nodeName: "New row",
  config: {},
  intervalSeconds: 300,
  ...over,
});

const state = (
  over: Partial<TriggerStateSnapshot> = {},
): TriggerStateSnapshot => ({
  cursor: undefined,
  lastSeenIds: [],
  lastPolledAt: new Date(NOW.getTime() - 10 * 60_000),
  failureCount: 0,
  nextPollAt: null,
  keyFingerprint: null,
  ...over,
});

const poller = (
  items: PollItem[],
  cursor: unknown = "cursor-1",
): PollingTrigger => ({
  poll: vi.fn(async () => ({ items, cursor })),
});

const rows = (n: number, prefix = "row"): PollItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    data: { index: i },
  }));

describe("isPollDue", () => {
  it("polls a trigger that has never been polled", () => {
    expect(isPollDue(trigger(), null, NOW)).toBe(true);
  });

  it("respects a backoff window set by a previous failure", () => {
    const backedOff = state({
      nextPollAt: new Date(NOW.getTime() + 60_000),
      lastPolledAt: new Date(NOW.getTime() - 10 * 60_000),
    });
    expect(isPollDue(trigger(), backedOff, NOW)).toBe(false);
  });

  it("polls once the backoff window has passed", () => {
    const expired = state({ nextPollAt: new Date(NOW.getTime() - 1000) });
    expect(isPollDue(trigger(), expired, NOW)).toBe(true);
  });

  it("waits out the configured interval", () => {
    const recent = state({ lastPolledAt: new Date(NOW.getTime() - 60_000) });
    expect(isPollDue(trigger({ intervalSeconds: 300 }), recent, NOW)).toBe(
      false,
    );
    expect(isPollDue(trigger({ intervalSeconds: 60 }), recent, NOW)).toBe(true);
  });
});

describe("normalizeInterval", () => {
  it("floors at the sweep cadence — nothing polls faster than the sweep", () => {
    expect(normalizeInterval(5)).toBe(MIN_POLL_INTERVAL_SECONDS);
  });

  it("falls back for absent, zero or unparseable values", () => {
    for (const input of [undefined, 0, -1, "banana", null]) {
      expect(normalizeInterval(input)).toBe(DEFAULT_POLL_INTERVAL_SECONDS);
    }
  });

  it("accepts a numeric string, as a Json config column yields", () => {
    expect(normalizeInterval("900")).toBe(900);
  });
});

describe("backoffSeconds", () => {
  it("doubles per consecutive failure and stops at the ceiling", () => {
    expect(backoffSeconds(1, 60)).toBe(120);
    expect(backoffSeconds(2, 60)).toBe(240);
    expect(backoffSeconds(20, 60)).toBe(MAX_BACKOFF_SECONDS);
  });
});

describe("runPoll — no history replay on activation (AF-M10-05)", () => {
  it("dispatches nothing on the first poll of a 500-row sheet", async () => {
    // The acceptance, stated as the failure it prevents: publishing a workflow
    // against an existing sheet must not start 500 runs.
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller(rows(500)),
      state: null,
      now: NOW,
    });

    expect(outcome.dispatch).toEqual([]);
    expect(outcome.nextState.cursor).toBe("cursor-1");
    // The ids ARE remembered, or the next poll would report them as new.
    expect(outcome.nextState.lastSeenIds.length).toBeGreaterThan(0);
  });

  it("tells the poller it is the first poll so it can fetch cheaply", async () => {
    const p = poller([]);
    await runPoll({ trigger: trigger(), poller: p, state: null, now: NOW });
    expect(p.poll).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstPoll: true, cursor: undefined }),
    );
  });

  it("treats an existing row that was never polled as a first poll too", async () => {
    // A row can exist with lastPolledAt null after a credential failure on the
    // very first attempt. That is still "we have never seen this sheet".
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller(rows(3)),
      state: state({ lastPolledAt: null }),
      now: NOW,
    });
    expect(outcome.dispatch).toEqual([]);
  });
});

describe("runPoll — at-least-once with dedupe (AF-M10-05)", () => {
  it("dispatches each item exactly once across two overlapping polls", async () => {
    // Providers answer "changed since T" inclusively, so consecutive windows
    // overlap. Without the id window the overlap is dispatched twice and the
    // user gets two invoices for one order.
    const first = await runPoll({
      trigger: trigger(),
      poller: poller(rows(3)),
      state: state({ lastPolledAt: null }),
      now: NOW,
    });
    expect(first.dispatch).toEqual([]);

    const second = await runPoll({
      trigger: trigger(),
      // row-2 was already seen; row-3 and row-4 are new.
      poller: poller([
        { id: "row-2", data: {} },
        { id: "row-3", data: {} },
        { id: "row-4", data: {} },
      ]),
      state: state({
        lastSeenIds: first.nextState.lastSeenIds,
        cursor: first.nextState.cursor,
      }),
      now: NOW,
    });

    expect(second.dispatch.map((i) => i.id)).toEqual(["row-3", "row-4"]);

    const third = await runPoll({
      trigger: trigger(),
      poller: poller([
        { id: "row-3", data: {} },
        { id: "row-4", data: {} },
      ]),
      state: state({ lastSeenIds: second.nextState.lastSeenIds }),
      now: NOW,
    });
    expect(third.dispatch).toEqual([]);
  });

  it("suppresses a duplicate id repeated within one poll", async () => {
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller([
        { id: "a-1", data: {} },
        { id: "a-1", data: {} },
        { id: "a-2", data: {} },
      ]),
      state: state(),
      now: NOW,
    });
    expect(outcome.dispatch.map((i) => i.id)).toEqual(["a-1", "a-2"]);
  });

  it("ignores items with no stable id rather than dispatching them", async () => {
    // An item without an id cannot be deduplicated, so dispatching it would
    // mean re-running it on every poll forever.
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller([
        { id: "", data: {} },
        { id: "ok-1", data: {} },
      ] as PollItem[]),
      state: state(),
      now: NOW,
    });
    expect(outcome.dispatch.map((i) => i.id)).toEqual(["ok-1"]);
  });

  it("caps one poll's dispatch and drains the rest next sweep", async () => {
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller(rows(MAX_ITEMS_PER_POLL + 20)),
      state: state(),
      now: NOW,
    });
    expect(outcome.dispatch).toHaveLength(MAX_ITEMS_PER_POLL);
  });

  it("bounds the id window so the row cannot grow without limit", async () => {
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller(rows(30)),
      state: state({
        lastSeenIds: Array.from(
          { length: SEEN_ID_WINDOW },
          (_, i) => `old-${i}`,
        ),
      }),
      now: NOW,
    });
    expect(outcome.nextState.lastSeenIds).toHaveLength(SEEN_ID_WINDOW);
    // The newest ids survive; the oldest are dropped.
    expect(outcome.nextState.lastSeenIds).toContain("row-29");
    expect(outcome.nextState.lastSeenIds).not.toContain("old-0");
  });
});

describe("runPoll — failure handling", () => {
  it("backs off and changes nothing else when the provider fails", async () => {
    const failing: PollingTrigger = {
      poll: vi.fn(async () => {
        throw new Error("429 Too Many Requests");
      }),
    };

    const outcome = await runPoll({
      trigger: trigger({ intervalSeconds: 60 }),
      poller: failing,
      state: state({ cursor: "keep-me", lastSeenIds: ["a", "b"] }),
      now: NOW,
    });

    expect(outcome.dispatch).toEqual([]);
    expect(outcome.error).toContain("429");
    // A provider outage costs a delay, never a gap in what gets processed.
    expect(outcome.nextState.cursor).toBe("keep-me");
    expect(outcome.nextState.lastSeenIds).toEqual(["a", "b"]);
    expect(outcome.nextState.failureCount).toBe(1);
    expect(outcome.nextState.nextPollAt?.getTime()).toBe(
      NOW.getTime() + 120_000,
    );
  });

  it("clears the failure count and backoff after a success", async () => {
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller([]),
      state: state({ failureCount: 4, nextPollAt: new Date(NOW) }),
      now: NOW,
    });
    expect(outcome.nextState.failureCount).toBe(0);
    expect(outcome.nextState.nextPollAt).toBeNull();
    expect(outcome.nextState.lastError).toBeNull();
  });
});

describe("runPoll — key fingerprint (AF-M10-10 prerequisite)", () => {
  it("drops the id window when what an item IS has changed", async () => {
    // The stored ids answer a question the node no longer asks. Keeping them
    // would suppress items the new key has never seen.
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller([{ id: "x-1", data: {} }]),
      state: state({
        lastSeenIds: ["x-1"],
        cursor: "old-cursor",
        keyFingerprint: "aaa",
      }),
      keyFingerprint: "bbb",
      now: NOW,
    });

    expect(outcome.dispatch.map((i) => i.id)).toEqual(["x-1"]);
    expect(outcome.nextState.keyFingerprint).toBe("bbb");
  });

  it("keeps the window when the fingerprint is unchanged", async () => {
    const outcome = await runPoll({
      trigger: trigger(),
      poller: poller([{ id: "x-1", data: {} }]),
      state: state({ lastSeenIds: ["x-1"], keyFingerprint: "aaa" }),
      keyFingerprint: "aaa",
      now: NOW,
    });
    expect(outcome.dispatch).toEqual([]);
  });
});
