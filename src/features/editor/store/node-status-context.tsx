"use client";

import type { Realtime } from "@inngest/realtime";
import { useInngestSubscription } from "@inngest/realtime/hooks";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { fetchAirtableCreateRecordRealtimeToken } from "@/features/executions/components/airtable-create-record/actions";
import { fetchAnthropicRealtimeToken } from "@/features/executions/components/anthropic/actions";
import { fetchDiscordRealtimeToken } from "@/features/executions/components/discord/actions";
import { fetchEmailSendRealtimeToken } from "@/features/executions/components/email-send/actions";
import { fetchGeminiRealtimeToken } from "@/features/executions/components/gemini/actions";
import { fetchGoogleSheetsAppendRealtimeToken } from "@/features/executions/components/google-sheets-append/actions";
import { fetchHttpRequestRealtimeToken } from "@/features/executions/components/http-request/actions";
import { fetchHubSpotCreateContactRealtimeToken } from "@/features/executions/components/hubspot-create-contact/actions";
import { fetchOpenAiRealtimeToken } from "@/features/executions/components/openai/actions";
import { fetchOpenAiCompatibleChatRealtimeToken } from "@/features/executions/components/openai-compatible-chat/actions";
import { fetchPostgresQueryRealtimeToken } from "@/features/executions/components/postgres-query/actions";
import { fetchSlackRealtimeToken } from "@/features/executions/components/slack/actions";
import { fetchWebhookOutRealtimeToken } from "@/features/executions/components/webhook-out/actions";
import { fetchGoogleFormTriggerRealtimeToken } from "@/features/triggers/components/google-form-trigger/actions";
import { fetchManualTriggerRealtimeToken } from "@/features/triggers/components/manual-trigger/actions";
import { fetchStripeTriggerRealtimeToken } from "@/features/triggers/components/stripe-trigger/actions";
import {
  AIRTABLE_CREATE_RECORD_CHANNEL_NAME,
  airtableCreateRecordChannel,
} from "@/inngest/channels/airtable-create-record";
import {
  ANTHROPIC_CHANNEL_NAME,
  anthropicChannel,
} from "@/inngest/channels/anthropic";
import {
  DISCORD_CHANNEL_NAME,
  discordChannel,
} from "@/inngest/channels/discord";
import {
  EMAIL_SEND_CHANNEL_NAME,
  emailSendChannel,
} from "@/inngest/channels/email-send";
import { GEMINI_CHANNEL_NAME, geminiChannel } from "@/inngest/channels/gemini";
import {
  GOOGLE_FORM_TRIGGER_CHANNEL_NAME,
  googleFormTriggerChannel,
} from "@/inngest/channels/google-form-trigger";
import {
  GOOGLE_SHEETS_APPEND_CHANNEL_NAME,
  googleSheetsAppendChannel,
} from "@/inngest/channels/google-sheets-append";
import {
  HTTP_REQUEST_CHANNEL_NAME,
  httpRequestChannel,
} from "@/inngest/channels/http-request";
import {
  HUBSPOT_CREATE_CONTACT_CHANNEL_NAME,
  hubspotCreateContactChannel,
} from "@/inngest/channels/hubspot-create-contact";
import {
  MANUAL_TRIGGER_CHANNEL_NAME,
  manualTriggerChannel,
} from "@/inngest/channels/manual-trigger";
import { OPENAI_CHANNEL_NAME, openAiChannel } from "@/inngest/channels/openai";
import {
  OPENAI_COMPATIBLE_CHAT_CHANNEL_NAME,
  openAiCompatibleChatChannel,
} from "@/inngest/channels/openai-compatible-chat";
import {
  POSTGRES_QUERY_CHANNEL_NAME,
  postgresQueryChannel,
} from "@/inngest/channels/postgres-query";
import { SLACK_CHANNEL_NAME, slackChannel } from "@/inngest/channels/slack";
import {
  STRIPE_TRIGGER_CHANNEL_NAME,
  stripeTriggerChannel,
} from "@/inngest/channels/stripe-trigger";
import {
  WEBHOOK_OUT_CHANNEL_NAME,
  webhookOutChannel,
} from "@/inngest/channels/webhook-out";

type NodeStatusMap = Map<string, NodeStatus>;

const NodeStatusContext = createContext<NodeStatusMap>(new Map());

export function useNodeStatusFromContext(nodeId: string): NodeStatus {
  const map = useContext(NodeStatusContext);
  return map.get(nodeId) ?? "initial";
}

const CHANNEL_SUBSCRIPTIONS = [
  {
    channelName: OPENAI_CHANNEL_NAME,
    channel: openAiChannel,
    refreshToken: fetchOpenAiRealtimeToken,
  },
  {
    channelName: OPENAI_COMPATIBLE_CHAT_CHANNEL_NAME,
    channel: openAiCompatibleChatChannel,
    refreshToken: fetchOpenAiCompatibleChatRealtimeToken,
  },
  {
    channelName: POSTGRES_QUERY_CHANNEL_NAME,
    channel: postgresQueryChannel,
    refreshToken: fetchPostgresQueryRealtimeToken,
  },
  {
    channelName: ANTHROPIC_CHANNEL_NAME,
    channel: anthropicChannel,
    refreshToken: fetchAnthropicRealtimeToken,
  },
  {
    channelName: GEMINI_CHANNEL_NAME,
    channel: geminiChannel,
    refreshToken: fetchGeminiRealtimeToken,
  },
  {
    channelName: HTTP_REQUEST_CHANNEL_NAME,
    channel: httpRequestChannel,
    refreshToken: fetchHttpRequestRealtimeToken,
  },
  {
    channelName: GOOGLE_SHEETS_APPEND_CHANNEL_NAME,
    channel: googleSheetsAppendChannel,
    refreshToken: fetchGoogleSheetsAppendRealtimeToken,
  },
  {
    channelName: AIRTABLE_CREATE_RECORD_CHANNEL_NAME,
    channel: airtableCreateRecordChannel,
    refreshToken: fetchAirtableCreateRecordRealtimeToken,
  },
  {
    channelName: HUBSPOT_CREATE_CONTACT_CHANNEL_NAME,
    channel: hubspotCreateContactChannel,
    refreshToken: fetchHubSpotCreateContactRealtimeToken,
  },
  {
    channelName: DISCORD_CHANNEL_NAME,
    channel: discordChannel,
    refreshToken: fetchDiscordRealtimeToken,
  },
  {
    channelName: SLACK_CHANNEL_NAME,
    channel: slackChannel,
    refreshToken: fetchSlackRealtimeToken,
  },
  {
    channelName: EMAIL_SEND_CHANNEL_NAME,
    channel: emailSendChannel,
    refreshToken: fetchEmailSendRealtimeToken,
  },
  {
    channelName: MANUAL_TRIGGER_CHANNEL_NAME,
    channel: manualTriggerChannel,
    refreshToken: fetchManualTriggerRealtimeToken,
  },
  {
    channelName: GOOGLE_FORM_TRIGGER_CHANNEL_NAME,
    channel: googleFormTriggerChannel,
    refreshToken: fetchGoogleFormTriggerRealtimeToken,
  },
  {
    channelName: STRIPE_TRIGGER_CHANNEL_NAME,
    channel: stripeTriggerChannel,
    refreshToken: fetchStripeTriggerRealtimeToken,
  },
  {
    channelName: WEBHOOK_OUT_CHANNEL_NAME,
    channel: webhookOutChannel,
    refreshToken: fetchWebhookOutRealtimeToken,
  },
] as const;

function ChannelSubscriptionInner({
  channelName,
  refreshToken,
  onNewMessage,
}: {
  channelName: string;
  refreshToken: () => Promise<Realtime.Subscribe.Token>;
  onNewMessage: (
    channel: string,
    nodeId: string,
    status: string,
    createdAt: Date,
  ) => void;
}) {
  const { data } = useInngestSubscription({
    refreshToken,
    enabled: true,
  } as Parameters<typeof useInngestSubscription>[0]);

  const prevLenRef = useRef(0);

  useEffect(() => {
    if (data.length > prevLenRef.current) {
      const newMessages = data.slice(prevLenRef.current);
      prevLenRef.current = data.length;
      for (const msg of newMessages) {
        if (
          msg.kind === "data" &&
          msg.channel === channelName &&
          msg.topic === "status"
        ) {
          onNewMessage(
            channelName,
            msg.data.nodeId,
            msg.data.status,
            new Date(msg.createdAt),
          );
        }
      }
    }
  }, [data, channelName, onNewMessage]);

  return null;
}

export function NodeStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const mapRef = useRef(new Map<string, NodeStatus>());
  const timestampsRef = useRef(new Map<string, number>());
  const [, setTick] = useState(0);

  const handleNewMessage = useCallback(
    (_channel: string, nodeId: string, status: string, createdAt: Date) => {
      const map = mapRef.current;
      const incoming = createdAt.getTime();
      const prev = timestampsRef.current.get(nodeId);
      if (prev === undefined || incoming > prev) {
        map.set(nodeId, status as NodeStatus);
        timestampsRef.current.set(nodeId, incoming);
        setTick((t) => t + 1);
      }
    },
    [],
  );

  return (
    <NodeStatusContext value={mapRef.current}>
      {CHANNEL_SUBSCRIPTIONS.map((sub) => (
        <ChannelSubscriptionInner
          key={sub.channelName}
          channelName={sub.channelName}
          refreshToken={sub.refreshToken}
          onNewMessage={handleNewMessage}
        />
      ))}
      {children}
    </NodeStatusContext>
  );
}
