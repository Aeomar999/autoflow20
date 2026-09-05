import "server-only";
import { NonRetriableError } from "inngest";
import { SLACK_SCOPES } from "@/features/slack/scopes";
import { slackFetch } from "@/features/slack/server/slack-client";
import type { NodeRun } from "@/nodes/types";
import { parseSlackBlocks } from "../shared";

type SlackDmData = {
  variableName?: string;
  credentialId?: string;
  email?: string;
  text?: string;
  blocks?: string;
  skipIfNotFound?: boolean;
};

const SCOPES = [
  SLACK_SCOPES.usersReadEmail,
  SLACK_SCOPES.imWrite,
  SLACK_SCOPES.chatWrite,
];

export const execute: NodeRun<SlackDmData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("slack-dm-by-email", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Slack DM node: Variable name not configured",
      );
    }
    if (!data.email) {
      throw new NonRetriableError("Slack DM node: Email not configured");
    }
    if (!data.text && !data.blocks) {
      throw new NonRetriableError(
        "Slack DM node: no message configured. Set text, blocks, or both.",
      );
    }

    const where = "Slack DM node";
    const secret = credentials?.credentialId;
    const email = resolve(data.email).trim();

    let userId: string;
    try {
      const found = await slackFetch<{ user?: { id?: string; name?: string } }>(
        secret,
        {
          method: "users.lookupByEmail",
          httpMethod: "GET",
          params: { email },
          where,
          scopes: SCOPES,
        },
      );
      if (!found.user?.id) {
        throw new NonRetriableError(
          `${where}: Slack returned no user for ${email}.`,
        );
      }
      userId = found.user.id;
    } catch (error) {
      const notFound =
        error instanceof Error && error.message.includes("users_not_found");
      if (notFound && data.skipIfNotFound) {
        // An expected miss, not a failure: an external attendee has no Slack
        // account, and failing the run would stop the rest of the guest list
        // being messaged.
        return {
          ...context,
          [data.variableName]: {
            email,
            found: false,
            skipped: true,
            userId: null,
            ts: null,
          },
        };
      }
      throw error;
    }

    const text = data.text ? resolve(data.text) : "";
    const blocks = data.blocks
      ? parseSlackBlocks(resolve(data.blocks), where)
      : undefined;

    // chat.postMessage takes a user id directly as the channel and opens the
    // DM itself, so conversations.open is an extra round trip for nothing.
    const sent = await slackFetch<{ channel?: string; ts?: string }>(secret, {
      method: "chat.postMessage",
      params: {
        channel: userId,
        ...(text ? { text } : {}),
        ...(blocks ? { blocks } : {}),
      },
      where,
      scopes: SCOPES,
    });

    return {
      ...context,
      [data.variableName]: {
        email,
        found: true,
        skipped: false,
        userId,
        channel: sent.channel ?? null,
        ts: sent.ts ?? null,
      },
    };
  });
