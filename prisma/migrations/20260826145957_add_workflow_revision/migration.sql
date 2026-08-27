-- AF-M1-03: Add optimistic-concurrency revision counter to Workflow.
ALTER TABLE "Workflow" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
