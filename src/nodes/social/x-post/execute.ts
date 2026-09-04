import "server-only";
import { NonRetriableError } from "inngest";
import { X_MAX_POST_CHARS } from "@/features/social/constants";
import { postToX, weightedLength } from "@/features/social/server/x-client";
import type { NodeRun } from "@/nodes/types";

type XPostData = {
  variableName?: string;
  credentialId?: string;
  text?: string;
  replyToId?: string;
};

export const execute: NodeRun<XPostData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("x-post", async () => {
    if (!data.variableName) {
      throw new NonRetriableError("X Post node: Variable name not configured");
    }
    if (!data.text) {
      throw new NonRetriableError("X Post node: Text not configured");
    }

    const where = "X Post node";
    const text = resolve(data.text).trim();

    if (text.length === 0) {
      throw new NonRetriableError(
        `${where}: the text expression resolved to nothing.`,
      );
    }

    // Checked the way X counts, not with .length: emoji and most non-Latin
    // characters weigh two, so a post that looks like 275 characters can be
    // 300 to X — and its rejection does not say by how much.
    const weighted = weightedLength(text);
    if (weighted > X_MAX_POST_CHARS) {
      throw new NonRetriableError(
        `${where}: the post is ${weighted} weighted characters, over X's ${X_MAX_POST_CHARS} limit. X counts emoji and most non-Latin characters as two, so this is longer than it looks.`,
      );
    }

    const post = await postToX({
      secret: credentials?.credentialId,
      text,
      replyToId: data.replyToId ? resolve(data.replyToId).trim() : undefined,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: post.id ?? null,
        text: post.text ?? text,
        weightedLength: weighted,
        // The id doubles as the thread anchor: pass it to a later node's
        // replyToId to build a thread.
        url: post.id ? `https://x.com/i/web/status/${post.id}` : null,
      },
    };
  });
