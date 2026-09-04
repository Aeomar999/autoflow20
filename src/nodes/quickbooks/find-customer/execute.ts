import "server-only";
import { NonRetriableError } from "inngest";
import { findCustomer } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";

type QboFindCustomerData = {
  variableName?: string;
  credentialId?: string;
  displayName?: string;
  email?: string;
};

export const execute: NodeRun<QboFindCustomerData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("qbo-find-customer", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Find Customer node: Variable name not configured",
      );
    }

    const where = "QuickBooks Find Customer node";
    const connection = resolveQboConnection(credentials?.credentialId, where);

    const displayName = data.displayName
      ? resolve(data.displayName).trim()
      : "";
    const email = data.email ? resolve(data.email).trim() : "";

    const { customer, matches } = await findCustomer(connection, {
      displayName: displayName || undefined,
      email: email || undefined,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        // The branch key. "found" is what a CONDITION downstream tests, and
        // making it a real boolean rather than a null check keeps that
        // expression readable.
        found: customer !== null,
        customerId: customer?.Id ?? null,
        displayName: customer?.DisplayName ?? null,
        email: customer?.PrimaryEmailAddr?.Address ?? null,
        // Reported so an ambiguous match is visible. Two customers sharing an
        // email is a real bookkeeping state, and silently taking the first is
        // how an invoice lands on the wrong account.
        matches,
        customer,
      },
    };
  });
