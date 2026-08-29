import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { executeWorkflow } from "@/inngest/functions";
import { refreshOAuthTokens } from "@/inngest/oauth-refresh";
import { evaluateSchedules } from "@/inngest/cron";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeWorkflow, refreshOAuthTokens, evaluateSchedules],
});
