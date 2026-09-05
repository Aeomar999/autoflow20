/**
 * Run-cost share rules for the execution trace table (AF-UX-02).
 *
 * A node is flagged as an outlier when it accounts for strictly more than this
 * share of the run's total node cost — the plan's "highlight expensive nodes
 * (>10% of total)". Pure and IO-free so the threshold bound and the
 * null/zero/costless guards are unit-tested without a database.
 */
export const EXPENSIVE_COST_SHARE = 0.1;

/**
 * True when `costUsd` is strictly more than EXPENSIVE_COST_SHARE of
 * `totalCost`. Zero-cost nodes and costless runs can never be flagged, which
 * keeps cached hits (they record $0 spend) out of the highlight.
 */
export function isExpensiveCostShare(
  costUsd: number | null | undefined,
  totalCost: number,
): boolean {
  if (costUsd === null || costUsd === undefined) return false;
  if (!Number.isFinite(costUsd) || costUsd <= 0) return false;
  if (!Number.isFinite(totalCost) || totalCost <= 0) return false;
  return costUsd / totalCost > EXPENSIVE_COST_SHARE;
}
