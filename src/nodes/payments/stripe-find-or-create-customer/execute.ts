import "server-only";
import { NonRetriableError } from "inngest";
import { findOrCreateCustomer } from "@/features/stripe/server/stripe-client";
import { idempotencyKey } from "@/lib/server/idempotency";
import type { NodeRun } from "@/nodes/types";

type FindOrCreateCustomerData = {
  variableName?: string;
  credentialId?: string;
  email?: string;
  name?: string;
  phone?: string;
  metadata?: string;
};

export const execute: NodeRun<FindOrCreateCustomerData> = async ({
  data,
  nodeId,
  executionId,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("stripe-find-or-create-customer", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Stripe Customer node: Variable name not configured",
      );
    }
    if (!data.email) {
      throw new NonRetriableError("Stripe Customer node: Email not configured");
    }

    const where = "Stripe Customer node";
    const email = resolve(data.email).trim().toLowerCase();

    if (!email.includes("@")) {
      throw new NonRetriableError(
        `${where}: "${email}" is not an email address.`,
      );
    }

    let metadata: Record<string, string> | undefined;
    if (data.metadata) {
      const rendered = resolve(data.metadata).trim();
      if (rendered.length > 0) {
        try {
          const parsed = JSON.parse(rendered) as Record<string, unknown>;
          // Stripe metadata values are strings; a number here is silently
          // stringified by Stripe, so doing it here keeps the output honest.
          metadata = Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [key, String(value)]),
          );
        } catch {
          throw new NonRetriableError(
            `${where}: the metadata expression did not resolve to a JSON object.`,
          );
        }
      }
    }

    const { customer, created } = await findOrCreateCustomer({
      secret: credentials?.credentialId,
      email,
      name: data.name ? resolve(data.name).trim() : undefined,
      phone: data.phone ? resolve(data.phone).trim() : undefined,
      metadata,
      // Stable across retries of this step, distinct across runs. Stripe
      // honours it for 24 hours, so a retry returns the original customer
      // rather than creating a second one.
      idempotencyKey: idempotencyKey({ executionId, nodeId }),
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: customer.id,
        email: customer.email ?? email,
        name: customer.name ?? null,
        // False when an existing customer was reused — worth branching on for
        // a welcome email that should only go to genuinely new people.
        created,
      },
    };
  });
