import { decode } from "html-entities";
import { NonRetriableError } from "inngest";
import ky from "ky";
import { assertSafeEndpoint } from "@/features/executions/components/http-request/egress-guard";
import { compileTemplate } from "@/features/executions/template";
import type { NodeExecutor } from "@/features/executions/types";
import { slackChannel } from "@/inngest/channels/slack";

type SlackData = {
  variableName?: string;
  webhookUrl?: string;
  content?: string;
};

export const slackExecutor: NodeExecutor<SlackData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
}) => {
  await publish(
    slackChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  if (!data.content) {
    await publish(
      slackChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw new NonRetriableError("Slack node: Message content is required");
  }

  const rawContent = compileTemplate(data.content)(context);
  const content = decode(rawContent);

  try {
    const result = await step.run("slack-webhook", async () => {
      if (!data.webhookUrl) {
        await publish(
          slackChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Slack node: Webhook URL is required");
      }

      const webhookUrl = await assertSafeEndpoint(data.webhookUrl);
      await ky.post(webhookUrl, {
        json: {
          content: content, // The key depends on workflow config
        },
      });

      if (!data.variableName) {
        await publish(
          slackChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Slack node: Variable name is missing");
      }

      return {
        ...context,
        [data.variableName]: {
          messageContent: content.slice(0, 2000),
        },
      };
    });

    await publish(
      slackChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      slackChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
