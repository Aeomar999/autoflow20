import "server-only";
import { NonRetriableError } from "inngest";
import { SLACK_SCOPES } from "@/features/slack/scopes";
import { slackPaginate } from "@/features/slack/server/slack-client";
import type { NodeRun } from "@/nodes/types";

type SlackListChannelsData = {
  variableName?: string;
  credentialId?: string;
  nameFilter?: string;
  includePrivate?: boolean;
  includeArchived?: boolean;
  limit?: number;
};

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
  num_members?: number;
}

const SCOPES = [SLACK_SCOPES.channelsRead, SLACK_SCOPES.groupsRead];

export const execute: NodeRun<SlackListChannelsData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("slack-list-channels", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Slack List Channels node: Variable name not configured",
      );
    }

    const where = "Slack List Channels node";
    const types = data.includePrivate
      ? "public_channel,private_channel"
      : "public_channel";

    const { items, truncated } = await slackPaginate<SlackChannel>(
      credentials?.credentialId,
      {
        method: "conversations.list",
        params: {
          types,
          exclude_archived: data.includeArchived !== true,
        },
        itemsKey: "channels",
        limit: data.limit ?? 200,
        where,
        scopes: SCOPES,
      },
    );

    const wanted = data.nameFilter
      ? // Slack stores names lowercased and without a leading #, so a filter
        // typed as "#Alerts" must still match the channel called "alerts".
        resolve(data.nameFilter)
          .trim()
          .toLowerCase()
          .replace(/^#/, "")
      : "";

    const match = wanted
      ? (items.find((channel) => channel.name === wanted) ?? null)
      : null;

    return {
      ...context,
      [data.variableName]: {
        channels: items.map((channel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private ?? false,
          isArchived: channel.is_archived ?? false,
          memberCount: channel.num_members ?? null,
        })),
        count: items.length,
        // Reported, never silent: a create-if-absent flow that read a
        // truncated list would create a channel that already exists.
        truncated,
        // The branch key for create-if-absent.
        found: match !== null,
        channelId: match?.id ?? null,
        channelName: match?.name ?? null,
      },
    };
  });
