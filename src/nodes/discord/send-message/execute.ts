import "server-only";
import { decode } from "html-entities";
import { NonRetriableError } from "inngest";
import ky from "ky";
import { assertSafeEndpoint } from "@/features/executions/components/http-request/egress-guard";
import { compileTemplate } from "@/features/executions/template";
import { discordChannel } from "@/inngest/channels/discord";
import type { NodeRun } from "@/nodes/types";

type DiscordData = {
  variableName?: string;
  webhookUrl?: string;
  content?: string;
  username?: string;
};

export const execute: NodeRun<DiscordData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  await publish(
    discordChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  if (!data.content) {
    await publish(
      discordChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Discord node: Message content is required");
  }

  const rawContent = compileTemplate(data.content)(context);
  const content = decode(rawContent);
  const username = data.username
    ? decode(compileTemplate(data.username)(context))
    : undefined;

  try {
    const result = await step.run("discord-webhook", async () => {
      if (!data.webhookUrl) {
        await publish(
          discordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Discord node: Webhook URL is required");
      }

      const webhookUrl = await assertSafeEndpoint(data.webhookUrl);
      await ky.post(webhookUrl, {
        json: {
          content: content.slice(0, 2000), // Discord's max message length
          username,
        },
      });

      if (!data.variableName) {
        await publish(
          discordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Discord node: Variable name is missing");
      }

      return {
        ...context,
        [data.variableName]: {
          messageContent: content.slice(0, 2000),
        },
      };
    });

    await publish(
      discordChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      discordChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
