-- AF-M9-14 (ADR-0021). Fan-out segments fan a SPLIT_OUT array across the
-- interior nodes and re-close at an AGGREGATE. The engine records one
-- NodeExecution per node per item, so trace rows must identify *which* item
-- they belong to.
--
-- `NodeExecution.itemIndex` is the 0-based position of the item that produced
-- the row:
--   - NULL  -> the node ran outside a segment (every pre-AF-M9-14 row).
--   - set   -> a per-item execution of a segment interior node; inclusive of
--              SPLIT_OUT / AGGREGATE rows (itemIndex 0..count-1) so every box
--              on the canvas maps to at least one inspectable row.
--
-- Additive and nullable: no existing row changes meaning, and the trace
-- uniqueness key {executionId, nodeId, itemIndex} is covered by a plain
-- (non-unique) index because Inngest replays transiently create a duplicate
-- RUNNING row that a later attempt replaces.
ALTER TABLE "NodeExecution"
  ADD COLUMN "itemIndex" INTEGER;

-- Cover the per-item trace lookup {executionId, nodeId, itemIndex}. The
-- existing {executionId, order} index stays the ordering path; this one
-- serves "show every item execution of node X" (a fan-out inspector).
CREATE INDEX "NodeExecution_executionId_nodeId_itemIndex_idx"
  ON "NodeExecution" ("executionId", "nodeId", "itemIndex");
