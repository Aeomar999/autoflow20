import { describe, expect, it } from "vitest";
import { idempotencyKey } from "./idempotency";

describe("idempotencyKey (AF-M10-20)", () => {
  it("is STABLE across retries of the same step", () => {
    // The whole point. A key that changed per attempt would defeat the
    // provider's deduplication entirely: every retry would look like new work
    // and create a second customer, order, or charge.
    const first = idempotencyKey({ executionId: "exec-1", nodeId: "n1" });
    const second = idempotencyKey({ executionId: "exec-1", nodeId: "n1" });
    expect(first).toBe(second);
  });

  it("DIFFERS between two runs of the same node", () => {
    // The opposite failure, and the worse one: a key derived only from the
    // node would make the second run silently return the first run's object
    // instead of doing its work.
    expect(idempotencyKey({ executionId: "exec-1", nodeId: "n1" })).not.toBe(
      idempotencyKey({ executionId: "exec-2", nodeId: "n1" }),
    );
  });

  it("differs between two nodes in one run", () => {
    expect(idempotencyKey({ executionId: "exec-1", nodeId: "n1" })).not.toBe(
      idempotencyKey({ executionId: "exec-1", nodeId: "n2" }),
    );
  });

  it("differs by discriminator, for a node making several objects", () => {
    // An order per line item, say — same run, same node, deliberately
    // different work.
    expect(
      idempotencyKey({
        executionId: "e",
        nodeId: "n",
        discriminator: "item-1",
      }),
    ).not.toBe(
      idempotencyKey({
        executionId: "e",
        nodeId: "n",
        discriminator: "item-2",
      }),
    );
  });

  it("does not collide when parts shift across the boundary", () => {
    // Concatenating without a separator would make ("ab","c") and ("a","bc")
    // the same key.
    expect(idempotencyKey({ executionId: "ab", nodeId: "c" })).not.toBe(
      idempotencyKey({ executionId: "a", nodeId: "bc" }),
    );
  });

  it("stays inside Stripe's 255-character limit whatever it is given", () => {
    const key = idempotencyKey({
      executionId: "e".repeat(500),
      nodeId: "n".repeat(500),
      discriminator: "d".repeat(5000),
    });
    expect(key.length).toBeLessThanOrEqual(255);
  });

  it("does not leak the values it was built from", () => {
    // The key reaches the provider's logs. A concatenated key would put
    // record contents there.
    const key = idempotencyKey({
      executionId: "exec-1",
      nodeId: "n1",
      discriminator: "customer@example.com",
    });
    expect(key).not.toContain("customer@example.com");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still produces a usable key for an ad-hoc run with no execution", () => {
    const key = idempotencyKey({ executionId: undefined, nodeId: "n1" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
