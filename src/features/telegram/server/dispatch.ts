import "server-only";
import { logger } from "@/lib/logger";
import type { TelegramInbound } from "./webhook";

/**
 * Routing a Telegram update to the workflow that owns the secret (AF-M10-21).
 *
 * Unlike the GitHub and Intuit routes, this is **one endpoint per workflow**:
 * the URL carries the workflow id and the secret proves the delivery. That is
 * forced by how Telegram works — a bot has exactly one webhook URL, and the
 * only shared secret it will echo is the one set alongside that URL. So the
 * workflow is known before the body is read, and this only decides whether the
 * update is one the trigger asked for.
 */

type SnapshotNode = {
  id?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

export interface TelegramTriggerMatch {
  nodeId: string;
  matched: boolean;
  reason?: string;
}

const asIdList = (value: unknown): string[] =>
  typeof value === "string"
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

/**
 * Does the published graph want this update?
 *
 * Returns null when the workflow has no enabled Telegram trigger at all, which
 * is a different thing from "the filters excluded it" — the route reports the
 * first as a misconfiguration and the second as a normal no-op.
 */
export function matchTelegramTrigger(args: {
  graphSnapshot: unknown;
  update: TelegramInbound;
  workflowId: string;
}): TelegramTriggerMatch | null {
  let nodes: SnapshotNode[];
  try {
    const snapshot =
      typeof args.graphSnapshot === "string"
        ? (JSON.parse(args.graphSnapshot) as { nodes?: SnapshotNode[] })
        : (args.graphSnapshot as { nodes?: SnapshotNode[] } | null);
    nodes = snapshot?.nodes ?? [];
  } catch (error) {
    logger.error(
      `Telegram webhook: failed to parse graphSnapshot for workflow ${args.workflowId}`,
      { error },
    );
    return null;
  }

  const trigger = nodes.find(
    (node) => node?.type === "TELEGRAM_TRIGGER" && node.disabled !== true,
  );
  if (!trigger?.id) return null;

  // An update this product does not model — a poll answer, a chat-member
  // change. Signed and valid; simply nothing to run.
  if (args.update.kind === "unsupported") {
    return { nodeId: trigger.id, matched: false, reason: "unsupported update" };
  }

  const allowed = asIdList(trigger.data?.allowedChatIds);
  if (allowed.length > 0) {
    const chatId = args.update.chatId;
    if (chatId === null || !allowed.includes(String(chatId))) {
      return { nodeId: trigger.id, matched: false, reason: "chat not allowed" };
    }
  }

  const command =
    typeof trigger.data?.commandFilter === "string"
      ? trigger.data.commandFilter.trim()
      : "";
  if (command.length > 0) {
    // Telegram appends the bot's username in groups — "/report@my_bot" — so a
    // plain equality check would never match there.
    const text = args.update.text.trim();
    const first = text.split(/\s+/)[0]?.split("@")[0] ?? "";
    if (first.toLowerCase() !== command.toLowerCase()) {
      return { nodeId: trigger.id, matched: false, reason: "command mismatch" };
    }
  }

  return { nodeId: trigger.id, matched: true };
}

/** The context a Telegram-triggered run starts with. */
export function telegramTriggerContext(args: {
  update: TelegramInbound;
  body: unknown;
}): Record<string, unknown> {
  return {
    telegram: {
      updateId: args.update.updateId,
      kind: args.update.kind,
      chatId: args.update.chatId,
      text: args.update.text,
      from: args.update.from,
      // Present when the message carried an attachment; TELEGRAM_GET_FILE
      // turns it into a stored file.
      fileId: args.update.fileId,
      fileName: args.update.fileName,
      payload: args.body,
    },
  };
}
