-- Add per-workflow webhook secret for trigger URL ownership proof (AF-A-01).
-- gen_random_uuid() is built in on Postgres 13+, so existing rows are backfilled
-- and the default is dropped immediately after (Prisma generates cuid() client-side).

ALTER TABLE "Workflow" ADD COLUMN "webhookSecret" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

ALTER TABLE "Workflow" ALTER COLUMN "webhookSecret" DROP DEFAULT;

CREATE UNIQUE INDEX "Workflow_webhookSecret_key" ON "Workflow"("webhookSecret");
