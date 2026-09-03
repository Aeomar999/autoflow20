import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

const { findUnique, updateMany } = vi.hoisted(() => ({
  findUnique: vi.fn(async () => ({ status: "RUNNING" })),
  updateMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock("@/lib/db", () => ({
  default: {
    execution: { findUnique },
    nodeExecution: { updateMany },
  },
}));

import { withResolve } from "@/nodes/shared/test-params";
import { MAX_WAIT_SECONDS } from "./definition";
import { execute } from "./execute";

/**
 * Records what was slept for AND advances the clock by that much.
 *
 * Advancing matters: the executor decides whether to sleep again from how much
 * time is left, exactly as it does in production where `step.sleep` really
 * suspends. A double that recorded without advancing would make a 90-second
 * wait look like two chunks.
 */
const sleeps: number[] = [];
const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
  sleep: async (_id: string, ms: number) => {
    const amount = typeof ms === "number" ? ms : 0;
    sleeps.push(amount);
    vi.advanceTimersByTime(amount);
  },
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const run = (
  data: Record<string, unknown>,
  context: Record<string, unknown> = {},
) =>
  execute(
    withResolve({
      data,
      nodeId: "node_wait",
      executionId: "exec_1",
      workflowId: "wf_1",
      userId: "user_1",
      organizationId: "org_1",
      context,
      step,
      publish,
    }) as unknown as NodeRunParams,
  );

describe("WAIT (AF-M10-08)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-03T12:00:00.000Z") });
    sleeps.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when `until` is already past", async () => {
    // Waking late is the honest outcome; failing the run because the clock
    // moved on would turn a slow upstream node into an outage.
    const result = await run({
      mode: "until",
      until: "2020-01-01T00:00:00Z",
    });

    expect(sleeps).toEqual([]);
    expect(result.wait).toMatchObject({
      mode: "until",
      resolvedImmediately: true,
    });
  });

  it("sleeps for a duration and records where it will wake", async () => {
    const startedAt = Date.now();
    const result = await run({ mode: "duration", seconds: 90 });

    expect(sleeps).toEqual([90_000]);
    expect(new Date((result.wait as { wakeAt: string }).wakeAt).getTime()).toBe(
      startedAt + 90_000,
    );
    expect(result.wait).toMatchObject({ resolvedImmediately: false });
  });

  it("marks its trace row WAITING so a parked run does not read as hung", async () => {
    updateMany.mockClear();
    await run({ mode: "duration", seconds: 90 });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "WAITING" },
      }),
    );
  });

  it("splits a long wait into chunks so cancellation is noticed", async () => {
    // One six-day sleepUntil is durable but opaque: the run cannot see it was
    // cancelled until it wakes, so "cancel" would mean "cancel in six days".
    await run({ mode: "duration", seconds: 3 * 60 * 60 });

    expect(sleeps).toEqual([3_600_000, 3_600_000, 3_600_000]);
  });

  it("stops when the run is cancelled while parked", async () => {
    findUnique.mockResolvedValueOnce({ status: "CANCELLED" });
    await expect(run({ mode: "duration", seconds: 7200 })).rejects.toThrow(
      /cancelled while waiting/i,
    );
  });

  it("refuses a timestamp it cannot read, naming the value", async () => {
    await expect(run({ mode: "until", until: "next tuesday" })).rejects.toThrow(
      /not a timestamp/i,
    );
  });

  it("refuses an `until` beyond the maximum wait", async () => {
    const farFuture = new Date(
      Date.now() + (MAX_WAIT_SECONDS + 86_400) * 1000,
    ).toISOString();
    await expect(run({ mode: "until", until: farFuture })).rejects.toThrow(
      /maximum wait/i,
    );
  });

  it("refuses a non-positive duration", async () => {
    await expect(run({ mode: "duration", seconds: 0 })).rejects.toThrow(
      /at least one second/i,
    );
  });
});
