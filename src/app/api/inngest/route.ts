import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { evaluateSchedules } from "@/inngest/cron";
import { executeWorkflow } from "@/inngest/functions";
import { refreshOAuthTokens } from "@/inngest/oauth-refresh";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeWorkflow, refreshOAuthTokens, evaluateSchedules],
});
