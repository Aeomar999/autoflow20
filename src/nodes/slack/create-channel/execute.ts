import "server-only";
import { NonRetriableError } from "inngest";
import { SLACK_SCOPES } from "@/features/slack/scopes";
import {
  normalizeChannelName,
  slackFetch,
  slackPaginate,
} from "@/features/slack/server/slack-client";
import type { NodeRun } from "@/nodes/types";

type SlackCreateChannelData = {
  variableName?: string;
  credentialId?: string;
  name?: string;
  isPrivate?: boolean;
  purpose?: string;
};

interface SlackChannel {
  id: string;
  name: string;
}

const SCOPES = [SLACK_SCOPES.channelsManage];

export const execute: NodeRun<SlackCreateChannelData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("slack-create-channel", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Slack Create Channel node: Variable name not configured",
      );
    }
    if (!data.name) {
      throw new NonRetriableError(
        "Slack Create Channel node: Channel name not configured",
      );
    }

    const where = "Slack Create Channel node";
    const secret = credentials?.credentialId;
    const name = normalizeChannelName(resolve(data.name));

    if (name.length === 0) {
      throw new NonRetriableError(
        `${where}: the name expression resolved to nothing usable. Slack channel names need at least one letter or digit.`,
      );
    }

    let channel: SlackChannel;
    let created = true;

    try {
      const result = await slackFetch<{ channel?: SlackChannel }>(secret, {
        method: "conversations.create",
        params: { name, is_private: data.isPrivate ?? false },
        where,
        scopes: SCOPES,
      });
      if (!result.channel) {
        throw new NonRetriableError(
          `${where}: Slack accepted the request but returned no channel.`,
        );
      }
      channel = result.channel;
    } catch (error) {
      // `name_taken` is the expected answer when this workflow already ran, or
      // when a person made the channel first. Failing the run would make a
      // create-if-absent flow unusable, so the existing channel is looked up
      // and returned instead — which also makes a retried step idempotent.
      const isNameTaken =
        error instanceof Error && error.message.includes("name_taken");
      if (!isNameTaken) throw error;

      const { items } = await slackPaginate<SlackChannel>(secret, {
        method: "conversations.list",
        params: {
          types: data.isPrivate ? "private_channel" : "public_channel",
          exclude_archived: false,
        },
        itemsKey: "channels",
        limit: 1000,
        where,
        scopes: SCOPES,
      });

      const existing = items.find((row) => row.name === name);
      if (!existing) {
        // Slack says the name is taken but it is not in the list this token
        // can see — an archived channel, or one in a private conversation the
        // bot is not in. Say so rather than reporting a phantom success.
        throw new NonRetriableError(
          `${where}: Slack reports the name "${name}" is taken, but no channel with it is visible to this connection. It may be archived, or private and not shared with the bot.`,
        );
      }
      channel = existing;
      created = false;
    }

    if (data.purpose && created) {
      await slackFetch(secret, {
        method: "conversations.setPurpose",
        params: { channel: channel.id, purpose: resolve(data.purpose) },
        where,
        scopes: SCOPES,
      });
    }

    return {
      ...context,
      [data.variableName]: {
        channelId: channel.id,
        channelName: channel.name,
        // Distinguished so a downstream step can welcome-post only on a real
        // creation rather than on every run.
        created,
      },
    };
  });
