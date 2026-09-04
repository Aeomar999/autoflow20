import "server-only";
import { NonRetriableError } from "inngest";
import { SLACK_SCOPES } from "@/features/slack/scopes";
import { slackFetch } from "@/features/slack/server/slack-client";
import type { NodeRun } from "@/nodes/types";

type SlackInviteData = {
  variableName?: string;
  credentialId?: string;
  channel?: string;
  userIds?: string;
};

/** Slack caps `conversations.invite` at 1000 users per call. */
const MAX_INVITES = 1000;

const SCOPES = [SLACK_SCOPES.channelsManage];

export const execute: NodeRun<SlackInviteData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("slack-invite", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Slack Invite node: Variable name not configured",
      );
    }
    if (!data.channel) {
      throw new NonRetriableError("Slack Invite node: Channel not configured");
    }
    if (!data.userIds) {
      throw new NonRetriableError("Slack Invite node: User IDs not configured");
    }

    const where = "Slack Invite node";
    const users = resolve(data.userIds)
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (users.length === 0) {
      throw new NonRetriableError(
        `${where}: the user IDs expression resolved to no users.`,
      );
    }
    if (users.length > MAX_INVITES) {
      throw new NonRetriableError(
        `${where}: ${users.length} users exceeds Slack's ${MAX_INVITES}-per-call limit.`,
      );
    }

    const channel = resolve(data.channel).trim();

    try {
      await slackFetch(credentials?.credentialId, {
        method: "conversations.invite",
        params: { channel, users: users.join(",") },
        where,
        scopes: SCOPES,
      });
    } catch (error) {
      // Everyone named is already in the channel. That is the goal state, so
      // reporting failure would break any flow that re-runs — and Slack sends
      // this code even when only SOME of the users were already members.
      const alreadyIn =
        error instanceof Error && error.message.includes("already_in_channel");
      if (!alreadyIn) throw error;

      return {
        ...context,
        [data.variableName]: {
          channel,
          invited: 0,
          users,
          alreadyMembers: true,
        },
      };
    }

    return {
      ...context,
      [data.variableName]: {
        channel,
        invited: users.length,
        users,
        alreadyMembers: false,
      },
    };
  });
