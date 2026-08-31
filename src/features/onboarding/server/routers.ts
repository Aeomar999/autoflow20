import prisma from "@/lib/db";
import { createTRPCRouter, orgViewerProcedure } from "@/trpc/init";

import type { OnboardingStatus } from "../lib/state";

/**
 * Onboarding router (AF-M7-05).
 *
 * One procedure returning three counts, every one scoped through `ctx.org.id`
 * in the `where` clause. Counts rather than rows: the checklist only needs to
 * know whether the workspace has any of each, and a first-run workspace should
 * not pay to load lists it is about to be told are empty.
 *
 * `organizationId` comes back so the client can key its dismissal preference
 * per workspace — hiding the checklist in one workspace must not hide it in
 * another that genuinely is on its first run. It is the caller's own active
 * org, which they are already a member of.
 */
export const onboardingRouter = createTRPCRouter({
  status: orgViewerProcedure.query(
    async ({ ctx }): Promise<OnboardingStatus> => {
      const organizationId = ctx.org.id;

      const [workflowCount, credentialCount, executionCount] =
        await Promise.all([
          prisma.workflow.count({ where: { organizationId } }),
          prisma.credential.count({ where: { organizationId } }),
          // Executions reach the org through their workflow — `Execution` carries
          // no organizationId of its own (see data_model.md §2.4).
          prisma.execution.count({ where: { workflow: { organizationId } } }),
        ]);

      return {
        organizationId,
        workflowCount,
        credentialCount,
        executionCount,
      };
    },
  ),
});
