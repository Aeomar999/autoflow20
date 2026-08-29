import type { NodeProps, NodeTypes } from "@xyflow/react";
import { memo } from "react";
import { InitialNode } from "@/components/initial-node";
import { getNodeIconComponent } from "@/components/node-icon";
import { AirtableCreateRecordNode } from "@/features/executions/components/airtable-create-record/node";
import { AnthropicNode } from "@/features/executions/components/anthropic/node";
import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { DiscordNode } from "@/features/executions/components/discord/node";
import { EmailSendNode } from "@/features/executions/components/email-send/node";
import { GeminiNode } from "@/features/executions/components/gemini/node";
import { GoogleSheetsAppendNode } from "@/features/executions/components/google-sheets-append/node";
import { HttpRequestNode } from "@/features/executions/components/http-request/node";
import { HubSpotCreateContactNode } from "@/features/executions/components/hubspot-create-contact/node";
import { OpenAiNode } from "@/features/executions/components/openai/node";
import { OpenAiCompatibleChatNode } from "@/features/executions/components/openai-compatible-chat/node";
import { PostgresQueryNode } from "@/features/executions/components/postgres-query/node";
import { SlackNode } from "@/features/executions/components/slack/node";
import { WebhookOutNode } from "@/features/executions/components/webhook-out/node";
import { BaseTriggerNode } from "@/features/triggers/components/base-trigger-node";
import { GoogleFormTrigger } from "@/features/triggers/components/google-form-trigger/node";
import { ManualTriggerNode } from "@/features/triggers/components/manual-trigger/node";
import { StripeTriggerNode } from "@/features/triggers/components/stripe-trigger/node";
import { findManifestEntry, nodeManifest } from "@/nodes/manifest";

export const GenericNode = memo((props: NodeProps) => {
  const def =
    findManifestEntry(props.type) ||
    (props.type === "INITIAL"
      ? findManifestEntry("MANUAL_TRIGGER")
      : undefined);
  const isTrigger = def?.category === "TRIGGER";
  const icon = def ? getNodeIconComponent(def) : "Box";
  const name = (props.data?.name as string) || def?.label || props.type;
  const description = def?.description;

  if (isTrigger) {
    return (
      <BaseTriggerNode
        {...props}
        icon={icon}
        name={name}
        description={description}
      />
    );
  }

  return (
    <BaseExecutionNode
      {...props}
      id={props.id}
      icon={icon}
      name={name}
      description={description}
    />
  );
});
GenericNode.displayName = "GenericNode";

const explicitComponents = {
  INITIAL: InitialNode,
  HTTP_REQUEST: HttpRequestNode,
  MANUAL_TRIGGER: ManualTriggerNode,
  GOOGLE_FORM_TRIGGER: GoogleFormTrigger,
  STRIPE_TRIGGER: StripeTriggerNode,
  GEMINI: GeminiNode,
  OPENAI: OpenAiNode,
  OPENAI_COMPATIBLE_CHAT: OpenAiCompatibleChatNode,
  POSTGRES_QUERY: PostgresQueryNode,
  GOOGLE_SHEETS_APPEND: GoogleSheetsAppendNode,
  AIRTABLE_CREATE_RECORD: AirtableCreateRecordNode,
  HUBSPOT_CREATE_CONTACT: HubSpotCreateContactNode,
  ANTHROPIC: AnthropicNode,
  DISCORD: DiscordNode,
  SLACK: SlackNode,
  EMAIL_SEND: EmailSendNode,
  WEBHOOK_OUT: WebhookOutNode,
} as const;

// Register all manifest entries with either explicit component or GenericNode fallback
const allComponents: Record<string, React.ComponentType<NodeProps>> = {
  ...explicitComponents,
};

for (const entry of nodeManifest) {
  if (!allComponents[entry.type]) {
    allComponents[entry.type] = GenericNode;
  }
}

export const nodeComponents = allComponents satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof explicitComponents;
