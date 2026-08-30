import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { evaluateSchedules } from "@/inngest/cron";
import { executeWorkflow } from "@/inngest/functions";
import {
  processKnowledgeSource,
  scheduledKnowledgeSync,
} from "@/inngest/knowledge";
import { refreshOAuthTokens } from "@/inngest/oauth-refresh";

// Create an API that serves functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    executeWorkflow,
    refreshOAuthTokens,
    evaluateSchedules,
    processKnowledgeSource,
    scheduledKnowledgeSync,
  ],
});
