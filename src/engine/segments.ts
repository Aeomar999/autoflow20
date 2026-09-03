import { AGGREGATE_TYPE, SPLIT_OUT_TYPE } from "./validate";

/**
 * Fan-out segment planning (AF-M9-14, ADR-0021).
 *
 * Given the validate()-approved node/edge shapes (pairing + nesting + crossing
 * all confirmed), this turns the ordering information into the per-SPLIT_OUT
 * plan the engine needs to run a segment: its paired AGGREGATE and the ordered
 * list of interior node ids to iterate once per item.
 *
 * Pure and dependency-light so it is unit-testable without a database. It
 * assumes the shape validator already rejected malformed segments; when a
 * stale snapshot nevertheless yields an unpaired boundary, the pair is simply
 * dropped here and the engine's `consumedNodeIds` will not include it — the
 * node then goes through the normal single-run path instead of crashing.
 */

export type SegmentNodeLike = { id: string; type: string };
export type SegmentEdgeLike = { fromNodeId: string; toNodeId: string };

export type SegmentPlanEntry = {
  splitNodeId: string;
  aggregateNodeId: string;
  /** Interior node ids, in plan order (each runs once per item). */
  interiorNodeIds: string[];
};

/** All node ids reachable from `start` along directed edges. */
function reachableFrom(
  start: string,
  nodes: SegmentNodeLike[],
  edges: SegmentEdgeLike[],
): Set<string> {
  const out = new Set<string>([start]);
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.fromNodeId);
    if (list) list.push(e.toNodeId);
  }
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    for (const next of adj.get(queue[head]) ?? []) {
      if (!out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
    head++;
  }
  return out;
}

/** Node ids that can reach `target` (reverse BFS over parents). */
function canReachTarget(
  target: string,
  nodes: SegmentNodeLike[],
  edges: SegmentEdgeLike[],
): Set<string> {
  const parents = new Map<string, string[]>();
  for (const n of nodes) parents.set(n.id, []);
  for (const e of edges) {
    parents.get(e.toNodeId)?.push(e.fromNodeId);
  }
  const seen = new Set<string>([target]);
  const queue = [target];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const parent of parents.get(current) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
    }
  }
  return seen;
}

export type SegmentPlan = {
  /** One entry per SPLIT_OUT that has a valid paired AGGREGATE. */
  segments: SegmentPlanEntry[];
  /**
   * Every interior node id + every paired AGGREGATE id. The engine skips these
   * in the main loop because the segment runner already executed (or will
   * execute) them.
   */
  consumedNodeIds: Set<string>;
  /** SPLIT_OUT node ids that the engine must route to the segment runner. */
  segmentStartIds: Set<string>;
};

export function planSegments(
  nodes: SegmentNodeLike[],
  edges: SegmentEdgeLike[],
): SegmentPlan {
  const planIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const splits = nodes.filter((n) => n.type === SPLIT_OUT_TYPE);
  const aggregates = nodes.filter((n) => n.type === AGGREGATE_TYPE);
  const splitIds = new Set(splits.map((s) => s.id));
  const aggIds = new Set(aggregates.map((a) => a.id));

  const consumedNodeIds = new Set<string>();
  const segments: SegmentPlanEntry[] = [];

  for (const s of splits) {
    const fwd = reachableFrom(s.id, nodes, edges);
    const reachableAggs = aggregates.filter((a) => fwd.has(a.id));
    if (reachableAggs.length !== 1) continue; // validate() already rejected

    const a = reachableAggs[0];
    const back = canReachTarget(a.id, nodes, edges);
    if (!back.has(s.id)) continue; // not mutually reachable -> not a pair

    // Interior: nodes strictly between split and aggregate, reachable from the
    // split, that can reach the aggregate, excluding other boundaries. Sorted
    // by plan order so the chain iterates in the same order the canvas drew.
    const interiorNodeIds = nodes
      .filter(
        (n) =>
          n.id !== s.id &&
          n.id !== a.id &&
          fwd.has(n.id) &&
          back.has(n.id) &&
          !splitIds.has(n.id) &&
          !aggIds.has(n.id),
      )
      .sort((x, y) => (planIndex.get(x.id) ?? 0) - (planIndex.get(y.id) ?? 0))
      .map((n) => n.id);

    segments.push({
      splitNodeId: s.id,
      aggregateNodeId: a.id,
      interiorNodeIds,
    });
    consumedNodeIds.add(a.id);
    for (const interiorId of interiorNodeIds) {
      consumedNodeIds.add(interiorId);
    }
  }

  return {
    segments,
    consumedNodeIds,
    segmentStartIds: new Set(segments.map((seg) => seg.splitNodeId)),
  };
}
