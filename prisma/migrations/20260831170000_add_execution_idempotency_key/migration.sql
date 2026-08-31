-- AF-M8-01: caller-supplied idempotency key for POST /workflows/:id/run.
--
-- Additive only. A unique (workflowId, idempotencyKey) lets a retried run with
-- the same Idempotency-Key collide at the DB so exactly one Execution is ever
-- created. Postgres treats NULLs as distinct in a unique index, so rows created
-- without an idempotency key are completely unaffected (multiple NULLs allowed).
--
-- Guarded (IF NOT EXISTS) to stay replayable, matching the other additive
-- migrations. Physical names follow Prisma @@map ("Execution" is PascalCase).

ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Execution_workflowId_idempotencyKey_key"
    ON "Execution"("workflowId", "idempotencyKey");
