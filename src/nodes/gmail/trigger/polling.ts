import "server-only";
import {
  getGmailMessage,
  listGmailMessages,
} from "@/features/google/server/gmail";
import type { PollingTrigger } from "@/nodes/types";

type GmailTriggerConfig = {
  query?: string;
  labelIds?: string;
};

/**
 * `GMAIL_TRIGGER`'s poller (AF-M10-15 on the AF-M10-05 framework).
 *
 * Two calls per new message — list, then get — because Gmail's list returns
 * only ids. The list is bounded by the framework's `limit`, so a query that
 * matches an entire mailbox costs one page, not the mailbox.
 */
export const polling: PollingTrigger<GmailTriggerConfig> = {
  defaultIntervalSeconds: 300,

  async poll({ config, credentials, isFirstPoll, limit }) {
    const where = "Gmail trigger";
    const secret = credentials?.credentialId;

    const { ids } = await listGmailMessages({
      secret,
      query: config.query?.trim() ?? "is:unread",
      labelIds: config.labelIds
        ? config.labelIds
            .split(",")
            .map((label) => label.trim())
            .filter((label) => label.length > 0)
        : undefined,
      limit,
      where,
    });

    // On the first poll the framework dispatches nothing, so fetching each
    // message body would be `limit` wasted API calls against a quota the user
    // pays for. The ids alone establish the baseline.
    if (isFirstPoll) {
      return {
        items: ids.map((id) => ({ id, data: {} })),
        cursor: { lastPolledAt: new Date().toISOString() },
      };
    }

    const items = [];
    for (const id of ids) {
      const message = await getGmailMessage({ secret, messageId: id, where });
      items.push({ id, data: { message } });
    }

    return {
      items,
      // Informational: identity comes from the message id window, because a
      // Gmail query is not a "since" cursor.
      cursor: { lastPolledAt: new Date().toISOString() },
    };
  },
};
