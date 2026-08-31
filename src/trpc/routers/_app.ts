import { aiRouter } from "@/features/ai/server/routers";
import { analyticsRouter } from "@/features/analytics/server/routers";
import { apiKeysRouter } from "@/features/api-keys/server/router";
import { approvalsRouter } from "@/features/approvals/server/routers";
import { costsRouter } from "@/features/costs/server/routers";
import { credentialsRouter } from "@/features/credentials/server/routers";
import { executionsRouter } from "@/features/executions/server/routers";
import { knowledgeRouter } from "@/features/knowledge/server/routers";
import { organizationsRouter } from "@/features/organizations/server/routers";
import { templatesRouter } from "@/features/templates/server/routers";
import { workflowsRouter } from "@/features/workflows/server/routers";
import { createTRPCRouter } from "../init";

export const appRouter = createTRPCRouter({
  workflows: workflowsRouter,
  credentials: credentialsRouter,
  executions: executionsRouter,
  organizations: organizationsRouter,
  approvals: approvalsRouter,
  knowledge: knowledgeRouter,
  ai: aiRouter,
  analytics: analyticsRouter,
  costs: costsRouter,
  templates: templatesRouter,
  apiKeys: apiKeysRouter,
});

export type AppRouter = typeof appRouter;
