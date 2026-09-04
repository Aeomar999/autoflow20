import "server-only";
import { NonRetriableError } from "inngest";
import { findSubscriber } from "@/features/mailerlite/server/mailerlite-client";
import type { NodeRun } from "@/nodes/types";

type FindSubscriberData = {
  variableName?: string;
  credentialId?: string;
  email?: string;
};

export const execute: NodeRun<FindSubscriberData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("mailerlite-find-subscriber", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "MailerLite Find node: Variable name not configured",
      );
    }
    if (!data.email) {
      throw new NonRetriableError("MailerLite Find node: Email not configured");
    }

    const where = "MailerLite Find node";
    const email = resolve(data.email).trim().toLowerCase();

    if (email.length === 0) {
      throw new NonRetriableError(
        `${where}: the email expression resolved to nothing.`,
      );
    }

    const subscriber = await findSubscriber({
      secret: credentials?.credentialId,
      email,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        email,
        // A miss is an answer, not a failure: a list-hygiene workflow asks
        // this about people who are usually absent.
        found: subscriber !== null,
        id: subscriber?.id ?? null,
        // "active", "unsubscribed", "bounced", "junk". Worth branching on:
        // someone who unsubscribed still EXISTS, and re-adding them will not
        // resubscribe them.
        status: subscriber?.status ?? null,
        subscribedAt: subscriber?.subscribed_at ?? null,
        unsubscribedAt: subscriber?.unsubscribed_at ?? null,
        fields: subscriber?.fields ?? {},
        groups: (subscriber?.groups ?? []).map((group) => ({
          id: group.id ?? null,
          name: group.name ?? null,
        })),
      },
    };
  });
