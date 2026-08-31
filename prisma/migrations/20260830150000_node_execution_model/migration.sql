-- AF-M5-08: per-model cost attribution.
--
-- `NodeExecution.model` records the `provider:model` that actually served an
-- AI node (the fallback chain's winner, already carried in the run's usage
-- envelope but until now dropped at persist time). Cost-per-model reporting
-- groups on it. NULL for every non-AI node and for rows written before this.

ALTER TABLE "NodeExecution"
    ADD COLUMN IF NOT EXISTS "model" TEXT;

-- Reporting groups by model over a rolling window.
CREATE INDEX IF NOT EXISTS "NodeExecution_model_startedAt_idx"
    ON "NodeExecution"("model", "startedAt" DESC);
