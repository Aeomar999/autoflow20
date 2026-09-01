import { serve } from "inngest/next";
import { sweepAiResponseCache } from "@/inngest/ai-cache";
import { inngest } from "@/inngest/client";
import { evaluateSchedules } from "@/inngest/cron";
import { executeWorkflow } from "@/inngest/functions";
import {
  processKnowledgeSource,
  scheduledKnowledgeSync,
} from "@/inngest/knowledge";
import { notifyExpiringCredentials } from "@/inngest/notifications";
import { refreshOAuthTokens } from "@/inngest/oauth-refresh";
import { sweepExecutionHistory } from "@/inngest/retention";

// Create an API that serves functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeWorkflow,
    refreshOAuthTokens,
    evaluateSchedules,
    processKnowledgeSource,
    scheduledKnowledgeSync,
    sweepAiResponseCache,
    notifyExpiringCredentials,
    sweepExecutionHistory,
  ],
});
