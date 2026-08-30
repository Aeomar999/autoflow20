import { approvalsRouter } from "@/features/approvals/server/routers";
import { credentialsRouter } from "@/features/credentials/server/routers";
import { executionsRouter } from "@/features/executions/server/routers";
import { knowledgeRouter } from "@/features/knowledge/server/routers";
import { organizationsRouter } from "@/features/organizations/server/routers";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { createTRPCRouter } from "../init";

export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  credentials: credentialsRouter,
  executions: executionsRouter,
  organizations: organizationsRouter,
  approvals: approvalsRouter,
  knowledge: knowledgeRouter,
});

export type AppRouter = typeof appRouter;
