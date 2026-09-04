import "server-only";
import { NonRetriableError } from "inngest";
import { upsertSubscriber } from "@/features/mailerlite/server/mailerlite-client";
import type { NodeRun } from "@/nodes/types";

type CreateSubscriberData = {
  variableName?: string;
  credentialId?: string;
  email?: string;
  fields?: string;
  groupIds?: string;
};

export const execute: NodeRun<CreateSubscriberData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("mailerlite-create-subscriber", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "MailerLite Add Subscriber node: Variable name not configured",
      );
    }
    if (!data.email) {
      throw new NonRetriableError(
        "MailerLite Add Subscriber node: Email not configured",
      );
    }

    const where = "MailerLite Add Subscriber node";
    const email = resolve(data.email).trim().toLowerCase();

    if (!email.includes("@")) {
      throw new NonRetriableError(
        `${where}: "${email}" is not an email address.`,
      );
    }

    let fields: Record<string, unknown> | undefined;
    if (data.fields) {
      const rendered = resolve(data.fields).trim();
      if (rendered.length > 0) {
        try {
          const parsed = JSON.parse(rendered);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          fields = parsed as Record<string, unknown>;
        } catch {
          throw new NonRetriableError(
            `${where}: the fields expression did not resolve to a JSON object. Use three braces — {{{json person}}} — rather than two.`,
          );
        }
      }
    }

    const groupIds = data.groupIds
      ? resolve(data.groupIds)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      : [];

    const subscriber = await upsertSubscriber({
      secret: credentials?.credentialId,
      email,
      fields,
      groupIds,
      where,
    });

    const status = subscriber.status ?? null;

    return {
      ...context,
      [data.variableName]: {
        id: subscriber.id ?? null,
        email,
        status,
        // The distinction that matters: MailerLite answers 200 for someone who
        // previously opted out WITHOUT resubscribing them, so "the call
        // worked" is not the same as "they are on the list".
        subscribed: status === "active",
        groups: (subscriber.groups ?? []).map((group) => group.id ?? ""),
      },
    };
  });
