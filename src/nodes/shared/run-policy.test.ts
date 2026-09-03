import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  readRunPolicy,
  resolveRunPolicy,
  runPolicySchema,
} from "./run-policy";

/**
 * AF-M9-06. The precedence order is the whole contract here — a node's own
 * policy, then the legacy keys, then the definition, then the engine.
 */

const ENGINE = { maxAttempts: 3, backoffMs: 1000, timeoutMs: 60_000 };
const BARE = {};

describe("runPolicySchema", () => {
  it("accepts a complete policy", () => {
    expect(
      runPolicySchema.safeParse({
        maxAttempts: 3,
        backoffMs: 500,
        timeoutMs: 5000,
        continueOnFail: true,
      }).success,
    ).toBe(true);
  });

  it("accepts an empty policy — every field is optional", () => {
    expect(runPolicySchema.safeParse({}).success).toBe(true);
  });

  it("rejects an attempt count outside the bounds", () => {
    expect(runPolicySchema.safeParse({ maxAttempts: 0 }).success).toBe(false);
    expect(
      runPolicySchema.safeParse({ maxAttempts: MAX_ATTEMPTS + 1 }).success,
    ).toBe(false);
    expect(runPolicySchema.safeParse({ maxAttempts: 2.5 }).success).toBe(false);
  });

  it("rejects a timeout outside the bounds", () => {
    // A node may not opt out of being bounded (correctness property P5).
    expect(
      runPolicySchema.safeParse({ timeoutMs: MIN_TIMEOUT_MS - 1 }).success,
    ).toBe(false);
    expect(
      runPolicySchema.safeParse({ timeoutMs: MAX_TIMEOUT_MS + 1 }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean continueOnFail", () => {
    expect(runPolicySchema.safeParse({ continueOnFail: "yes" }).success).toBe(
      false,
    );
  });
});

describe("readRunPolicy", () => {
  it("returns undefined when absent", () => {
    expect(readRunPolicy({})).toBeUndefined();
    expect(readRunPolicy(undefined)).toBeUndefined();
    expect(readRunPolicy({ _run: null })).toBeUndefined();
  });

  it("degrades a malformed policy to undefined rather than throwing", () => {
    // The save boundary reports it; the runner must not refuse to execute a
    // node because its retry count is wrong.
    expect(readRunPolicy({ _run: { maxAttempts: 99 } })).toBeUndefined();
    expect(readRunPolicy({ _run: "nope" })).toBeUndefined();
  });
});

describe("resolveRunPolicy precedence", () => {
  it("falls back to the engine defaults for a bare node", () => {
    expect(resolveRunPolicy(BARE, {}, ENGINE)).toEqual({
      maxAttempts: 3,
      backoffMs: 1000,
      timeoutMs: 60_000,
      continueOnFail: false,
    });
  });

  it("prefers the definition over the engine defaults", () => {
    expect(
      resolveRunPolicy(
        BARE,
        { defaultRetry: { maxAttempts: 2, backoffMs: 250 }, timeoutMs: 5000 },
        ENGINE,
      ),
    ).toEqual({
      maxAttempts: 2,
      backoffMs: 250,
      timeoutMs: 5000,
      continueOnFail: false,
    });
  });

  it("prefers the node's _run over the definition", () => {
    expect(
      resolveRunPolicy(
        { _run: { maxAttempts: 5, timeoutMs: 1000, continueOnFail: true } },
        { defaultRetry: { maxAttempts: 2, backoffMs: 250 }, timeoutMs: 5000 },
        ENGINE,
      ),
    ).toEqual({
      maxAttempts: 5,
      // Not set on _run, so the definition still supplies it.
      backoffMs: 250,
      timeoutMs: 1000,
      continueOnFail: true,
    });
  });

  it("still honours the legacy keys, below _run and above the definition", () => {
    // No migration ships, so a row written before AF-M9-06 must keep working.
    expect(
      resolveRunPolicy(
        { _timeoutMs: 1234, _continueOnFail: true },
        { timeoutMs: 5000 },
        ENGINE,
      ),
    ).toMatchObject({ timeoutMs: 1234, continueOnFail: true });
  });

  it("lets _run win over a legacy key on the same node", () => {
    expect(
      resolveRunPolicy(
        { _run: { timeoutMs: 2000 }, _timeoutMs: 1234 },
        {},
        ENGINE,
      ).timeoutMs,
    ).toBe(2000);
  });

  it("ignores a legacy timeout that is not a positive number", () => {
    expect(
      resolveRunPolicy({ _timeoutMs: 0 }, { timeoutMs: 5000 }, ENGINE)
        .timeoutMs,
    ).toBe(5000);
    expect(
      resolveRunPolicy({ _timeoutMs: "1000" }, { timeoutMs: 5000 }, ENGINE)
        .timeoutMs,
    ).toBe(5000);
  });

  it("clamps an out-of-bounds inherited timeout instead of rejecting it", () => {
    // A definition or legacy row may predate the bounds; refusing to run it
    // would turn a tightening of limits into an outage.
    expect(resolveRunPolicy({ _timeoutMs: 10 }, {}, ENGINE).timeoutMs).toBe(
      MIN_TIMEOUT_MS,
    );
    expect(
      resolveRunPolicy({}, { timeoutMs: 999_999_999 }, ENGINE).timeoutMs,
    ).toBe(MAX_TIMEOUT_MS);
  });

  it("defaults continueOnFail to false, never to undefined", () => {
    // The runner branches on it directly; undefined would read as false by
    // accident rather than by decision.
    expect(resolveRunPolicy(BARE, {}, ENGINE).continueOnFail).toBe(false);
  });
});
