import type { NodeTypes } from "@xyflow/react";
import { InitialNode } from "@/components/initial-node";
import { AnthropicNode } from "@/features/executions/components/anthropic/node";
import { DiscordNode } from "@/features/executions/components/discord/node";
import { EmailSendNode } from "@/features/executions/components/email-send/node";
import { GeminiNode } from "@/features/executions/components/gemini/node";
import { HttpRequestNode } from "@/features/executions/components/http-request/node";
import { OpenAiNode } from "@/features/executions/components/openai/node";
import { PostgresQueryNode } from "@/features/executions/components/postgres-query/node";
import { SlackNode } from "@/features/executions/components/slack/node";
import { WebhookOutNode } from "@/features/executions/components/webhook-out/node";
import { GoogleFormTrigger } from "@/features/triggers/components/google-form-trigger/node";
import { ManualTriggerNode } from "@/features/triggers/components/manual-trigger/node";
import { StripeTriggerNode } from "@/features/triggers/components/stripe-trigger/node";

export const nodeComponents = {
  INITIAL: InitialNode,
  HTTP_REQUEST: HttpRequestNode,
  MANUAL_TRIGGER: ManualTriggerNode,
  GOOGLE_FORM_TRIGGER: GoogleFormTrigger,
  STRIPE_TRIGGER: StripeTriggerNode,
  GEMINI: GeminiNode,
  OPENAI: OpenAiNode,
  POSTGRES_QUERY: PostgresQueryNode,
  ANTHROPIC: AnthropicNode,
  DISCORD: DiscordNode,
  SLACK: SlackNode,
  EMAIL_SEND: EmailSendNode,
  WEBHOOK_OUT: WebhookOutNode,
} as const satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof nodeComponents;
