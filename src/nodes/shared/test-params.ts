import { makeResolver } from "@/features/executions/template";
import type { NodeRunParams } from "@/nodes/types";

/**
 * Test-only helper for building `NodeRunParams` (AF-M9-05).
 *
 * `resolve` is required on `NodeRunParams` — an executor that could fall back
 * to compiling against `context` would reintroduce exactly the leak AF-M9-05
 * removed, so the field is deliberately not optional. That would otherwise mean
 * hand-writing a resolver in ~20 node unit-test fixtures.
 *
 * `withResolve` fills it in from the fixture's own `context`, using the SAME
 * `makeResolver` the runner uses, so a unit test cannot drift from what the
 * engine actually does. It lives outside a `.test.ts` file because several test
 * files import it; nothing in production code may.
 */
export function withResolve<
  T extends {
    context: NodeRunParams["context"];
    resolve?: unknown;
    item?: NodeRunParams["item"];
  },
>(params: T): T & { resolve: NodeRunParams["resolve"] } {
  return {
    ...params,
    resolve:
      (params.resolve as NodeRunParams["resolve"] | undefined) ??
      makeResolver(
        params.context,
        {},
        {
          executionId: "exec_test",
          workflowId: "wf_test",
        },
        // AF-M10-10: a fixture that supplies `item` is standing in for a node
        // inside a fan-out segment, and the engine puts `$item`/`$itemIndex`
        // in the resolver's scope there. Deriving the scope from the same
        // field the executor reads keeps the two from disagreeing — a test
        // whose templates resolved to "" would pass for the wrong reason.
        params.item
          ? { $item: params.item.value, $itemIndex: params.item.index }
          : undefined,
      ),
  };
}
