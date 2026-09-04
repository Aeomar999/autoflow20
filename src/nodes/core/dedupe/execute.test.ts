import { describe, expect, it, vi } from "vitest";
import type { NodeRunParams } from "@/nodes/types";

/**
 * The seen-key store is exercised against a real Postgres in
 * `tests/integration/dedupe.integration.test.ts`. Here it is a fake, so the
 * node's own decisions — which items are dropped, what it reports, what it
 * refuses — are asserted without a database.
 */
const { recordSeenKeys, seen } = vi.hoisted(() => {
  const seen = new Map<string, Set<string>>();
  const recordSeenKeys = vi.fn(
    async (args: {
      workflowId: string;
      nodeId: string;
      keys: string[];
      fingerprint: string;
    }) => {
      const bucket = `${args.workflowId}:${args.nodeId}:${args.fingerprint}`;
      const known = seen.get(bucket) ?? new Set<string>();
      seen.set(bucket, known);
      const fresh: string[] = [];
      const duplicates: string[] = [];
      for (const key of args.keys) {
        if (known.has(key)) {
          duplicates.push(key);
        } else {
          known.add(key);
          fresh.push(key);
        }
      }
      return { fresh, duplicates, reset: false };
    },
  );
  return { recordSeenKeys, seen };
});

vi.mock("@/features/triggers/server/dedupe-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/triggers/server/dedupe-store")
  >("@/features/triggers/server/dedupe-store");
  return { ...actual, recordSeenKeys };
});

import { withResolve } from "@/nodes/shared/test-params";
import { execute } from "./execute";

const step = {
  run: async <T>(_id: string, fn: () => Promise<T>): Promise<T> => fn(),
} as unknown as NodeRunParams["step"];

const publish = vi.fn(async () => {});

const run = (
  data: Record<string, unknown>,
  opts: {
    context?: Record<string, unknown>;
    item?: { value: unknown; index: number };
    workflowId?: string | undefined;
    organizationId?: string | undefined;
    nodeId?: string;
  } = {},
) =>
  execute(
    withResolve({
      data,
      nodeId: opts.nodeId ?? "node_dedupe",
      userId: "user_1",
      workflowId: "workflowId" in opts ? opts.workflowId : "wf_1",
      organizationId: "organizationId" in opts ? opts.organizationId : "org_1",
      context: opts.context ?? {},
      step,
      publish,
      ...(opts.item ? { item: opts.item } : {}),
    }) as unknown as NodeRunParams,
  );

describe("DEDUPE inside a fan-out segment (AF-M10-10)", () => {
  it("passes an item through the first time and drops the second", async () => {
    seen.clear();
    const item = { value: { email: "a@example.com" }, index: 0 };

    const first = await run(
      { key: "{{$item.email}}" },
      { item, nodeId: "seg_node" },
    );
    expect(first._dropItem).toBeUndefined();

    const second = await run(
      { key: "{{$item.email}}" },
      { item: { ...item, index: 1 }, nodeId: "seg_node" },
    );
    expect(second._dropItem).toBe(true);
  });

  it("refuses an item whose key resolves to nothing", async () => {
    // An empty key makes every item collide with every other, which reads as
    // "everything is a duplicate" and silently drops the whole batch.
    seen.clear();
    await expect(
      run(
        { key: "{{$item.missing}}" },
        { item: { value: { email: "x" }, index: 0 } },
      ),
    ).rejects.toThrow(/resolved to nothing/i);
  });
});

describe("DEDUPE outside a segment (AF-M10-10)", () => {
  const context = {
    rows: [
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "a@example.com" },
    ],
  };

  it("keeps the first occurrence and drops repeats within one batch", async () => {
    seen.clear();
    const result = await run(
      { variableName: "unique", items: "{{{json rows}}}", key: "email" },
      { context },
    );

    expect(result.unique).toMatchObject({
      kept: 2,
      duplicates: 1,
      total: 3,
    });
    expect((result.unique as { items: unknown[] }).items).toEqual([
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);
  });

  it("remembers across runs, which is the whole point", async () => {
    seen.clear();
    await run(
      { variableName: "unique", items: "{{{json rows}}}", key: "email" },
      { context },
    );
    const second = await run(
      { variableName: "unique", items: "{{{json rows}}}", key: "email" },
      { context },
    );
    expect(second.unique).toMatchObject({ kept: 0, duplicates: 3 });
  });

  it("scopes the window to the node, not the workflow", async () => {
    // Two DEDUPE nodes in one workflow ask different questions; sharing a
    // window would make the second one drop everything the first saw.
    seen.clear();
    await run(
      { variableName: "unique", items: "{{{json rows}}}", key: "email" },
      { context, nodeId: "node_a" },
    );
    const other = await run(
      { variableName: "unique", items: "{{{json rows}}}", key: "email" },
      { context, nodeId: "node_b" },
    );
    expect((other.unique as { kept: number }).kept).toBe(2);
  });

  it("refuses a batch with blank keys rather than collapsing it", async () => {
    seen.clear();
    await expect(
      run(
        { variableName: "unique", items: "{{{json rows}}}", key: "missing" },
        { context },
      ),
    ).rejects.toThrow(/no value at "missing"/);
  });

  it("refuses to run with no key configured", async () => {
    await expect(
      run({ variableName: "unique", items: "{{{json rows}}}" }, { context }),
    ).rejects.toThrow(/no key configured/i);
  });

  it("fails loudly when the run has nowhere to keep state", async () => {
    // Silently deduplicating nothing is the failure this node exists to
    // prevent, so a run with no workflow must not quietly pass everything.
    await expect(
      run(
        { variableName: "unique", items: "{{{json rows}}}", key: "email" },
        { context, workflowId: undefined },
      ),
    ).rejects.toThrow(/seen-key window cannot be read or written/i);
  });
});
