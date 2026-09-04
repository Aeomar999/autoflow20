import "server-only";
import { NonRetriableError } from "inngest";
import { createCustomer } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";

type QboCreateCustomerData = {
  variableName?: string;
  credentialId?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
};

export const execute: NodeRun<QboCreateCustomerData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("qbo-create-customer", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Create Customer node: Variable name not configured",
      );
    }
    if (!data.displayName) {
      throw new NonRetriableError(
        "QuickBooks Create Customer node: Display name not configured",
      );
    }

    const where = "QuickBooks Create Customer node";
    const connection = resolveQboConnection(credentials?.credentialId, where);

    const displayName = resolve(data.displayName).trim();
    if (displayName.length === 0) {
      // A blank name is a template that resolved to nothing. QBO would accept
      // it and the company would gain a nameless customer nobody can find.
      throw new NonRetriableError(
        `${where}: the display name expression resolved to an empty string.`,
      );
    }

    const customer = await createCustomer(connection, {
      displayName,
      email: data.email ? resolve(data.email).trim() || undefined : undefined,
      phone: data.phone ? resolve(data.phone).trim() || undefined : undefined,
      companyName: data.companyName
        ? resolve(data.companyName).trim() || undefined
        : undefined,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        customerId: customer.Id,
        displayName: customer.DisplayName,
        customer,
      },
    };
  });
