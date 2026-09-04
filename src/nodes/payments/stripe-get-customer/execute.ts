import "server-only";
import { NonRetriableError } from "inngest";
import { stripeFetch } from "@/features/stripe/server/stripe-client";
import type { NodeRun } from "@/nodes/types";

type GetCustomerData = {
  variableName?: string;
  credentialId?: string;
  customerId?: string;
};

export const execute: NodeRun<GetCustomerData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("stripe-get-customer", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Stripe Get Customer node: Variable name not configured",
      );
    }
    if (!data.customerId) {
      throw new NonRetriableError(
        "Stripe Get Customer node: Customer id not configured",
      );
    }

    const where = "Stripe Get Customer node";
    const customerId = resolve(data.customerId).trim();

    if (!customerId.startsWith("cus_")) {
      throw new NonRetriableError(
        `${where}: "${customerId}" is not a customer id. Stripe customer ids start with cus_.`,
      );
    }

    const customer = await stripeFetch<{
      id: string;
      email?: string | null;
      name?: string | null;
      phone?: string | null;
      created?: number;
      currency?: string | null;
      balance?: number;
      delinquent?: boolean;
      deleted?: boolean;
      metadata?: Record<string, string>;
      invoice_settings?: { default_payment_method?: string | null };
    }>(credentials?.credentialId, {
      path: `/customers/${customerId}`,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: customer.id,
        email: customer.email ?? null,
        name: customer.name ?? null,
        phone: customer.phone ?? null,
        currency: customer.currency ?? null,
        // In the smallest currency unit, and NEGATIVE means credit. Passed
        // through as Stripe gives it rather than "helpfully" flipped.
        balance: customer.balance ?? 0,
        delinquent: customer.delinquent ?? false,
        // Stripe returns a deleted customer as a normal 200 with deleted:true
        // rather than a 404, so a workflow that only checked the status would
        // treat a deleted account as live.
        deleted: customer.deleted ?? false,
        metadata: customer.metadata ?? {},
        defaultPaymentMethod:
          customer.invoice_settings?.default_payment_method ?? null,
      },
    };
  });
