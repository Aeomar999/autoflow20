"use client";

import type { Realtime } from "@inngest/realtime";
import { useInngestSubscription } from "@inngest/realtime/hooks";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { fetchAnthropicRealtimeToken } from "@/features/executions/components/anthropic/actions";
import { fetchDiscordRealtimeToken } from "@/features/executions/components/discord/actions";
import { fetchGeminiRealtimeToken } from "@/features/executions/components/gemini/actions";
import { fetchHttpRequestRealtimeToken } from "@/features/executions/components/http-request/actions";
import { fetchOpenAiRealtimeToken } from "@/features/executions/components/openai/actions";
import { fetchSlackRealtimeToken } from "@/features/executions/components/slack/actions";
import { fetchWebhookOutRealtimeToken } from "@/features/executions/components/webhook-out/actions";
import { fetchGoogleFormTriggerRealtimeToken } from "@/features/triggers/components/google-form-trigger/actions";
import { fetchManualTriggerRealtimeToken } from "@/features/triggers/components/manual-trigger/actions";
import { fetchStripeTriggerRealtimeToken } from "@/features/triggers/components/stripe-trigger/actions";
import {
  ANTHROPIC_CHANNEL_NAME,
  anthropicChannel,
} from "@/inngest/channels/anthropic";
import {
  DISCORD_CHANNEL_NAME,
  discordChannel,
} from "@/inngest/channels/discord";
import { GEMINI_CHANNEL_NAME, geminiChannel } from "@/inngest/channels/gemini";
import {
  GOOGLE_FORM_TRIGGER_CHANNEL_NAME,
  googleFormTriggerChannel,
} from "@/inngest/channels/google-form-trigger";
import {
  HTTP_REQUEST_CHANNEL_NAME,
  httpRequestChannel,
} from "@/inngest/channels/http-request";
import {
  MANUAL_TRIGGER_CHANNEL_NAME,
  manualTriggerChannel,
} from "@/inngest/channels/manual-trigger";
import { OPENAI_CHANNEL_NAME, openAiChannel } from "@/inngest/channels/openai";
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
