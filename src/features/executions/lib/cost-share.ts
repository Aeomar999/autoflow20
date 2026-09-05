/**
 * AF-UX-02: a node counts as "expensive" when it is strictly more than this
 * share of the run's total node cost.
 */
export const EXPENSIVE_COST_SHARE = 0.1;

/**
 * True when `costUsd` is strictly more than `EXPENSIVE_COST_SHARE` of
 * `totalCost`. Zero, missing, and non-finite values are never flagged — a
 * cached hit (records $0) or an empty run must not be "expensive".
 */
export function isExpensiveCostShare(
  costUsd: number | null | undefined,
  totalCost: number,
): boolean {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd <= 0) {
    return false;
  }
  if (!Number.isFinite(totalCost) || totalCost <= 0) {
    return false;
  }
  return costUsd / totalCost > EXPENSIVE_COST_SHARE;
}
