import "server-only";
import { NonRetriableError } from "inngest";
import { SLACK_SCOPES } from "@/features/slack/scopes";
import { slackFetch } from "@/features/slack/server/slack-client";
import type { NodeRun } from "@/nodes/types";
import { parseSlackBlocks } from "../shared";

type SlackPostData = {
  variableName?: string;
  credentialId?: string;
  channel?: string;
  text?: string;
  blocks?: string;
  threadTs?: string;
};

const SCOPES = [SLACK_SCOPES.chatWrite, SLACK_SCOPES.chatWritePublic];

export const execute: NodeRun<SlackPostData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("slack-post", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Slack Post node: Variable name not configured",
      );
    }
    if (!data.channel) {
      throw new NonRetriableError("Slack Post node: Channel not configured");
    }
    if (!data.text && !data.blocks) {
      throw new NonRetriableError(
        "Slack Post node: no message configured. Set text, blocks, or both.",
      );
    }

    const where = "Slack Post node";
    const text = data.text ? resolve(data.text) : "";
    const blocks = data.blocks
      ? parseSlackBlocks(resolve(data.blocks), where)
      : undefined;

    if (blocks && text.trim().length === 0) {
      // Slack accepts blocks with no text and then shows an empty string in
      // the notification and the channel list. The fallback is not optional
      // in practice, only in the API.
      throw new NonRetriableError(
        `${where}: blocks are set but text is empty. Slack uses text as the notification fallback shown in the sidebar and on push, so leaving it blank ships a message that reads as empty everywhere except the channel itself.`,
      );
    }

    const result = await slackFetch<{
      channel?: string;
      ts?: string;
      message?: { text?: string };
    }>(credentials?.credentialId, {
      method: "chat.postMessage",
      params: {
        channel: resolve(data.channel).trim(),
        ...(text ? { text } : {}),
        ...(blocks ? { blocks } : {}),
        ...(data.threadTs ? { thread_ts: resolve(data.threadTs).trim() } : {}),
      },
      where,
      scopes: SCOPES,
    });

    return {
      ...context,
      [data.variableName]: {
        channel: result.channel ?? null,
        // The message timestamp doubles as its id: pass it to a later post's
        // threadTs to reply in-thread.
        ts: result.ts ?? null,
      },
    };
  });
