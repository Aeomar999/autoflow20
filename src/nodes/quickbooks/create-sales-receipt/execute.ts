import "server-only";
import { NonRetriableError } from "inngest";
import { createSalesReceipt } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";
import { parseQboLines } from "../parse";

type SalesDocumentData = {
  variableName?: string;
  credentialId?: string;
  customerId?: string;
  lines?: string;
  email?: string;
  depositToAccountId?: string;
  docNumber?: string;
  customerMemo?: string;
};

export const execute: NodeRun<SalesDocumentData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("qbo-create-sales-receipt", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Create Sales Receipt node: Variable name not configured",
      );
    }
    if (!data.customerId) {
      throw new NonRetriableError(
        "QuickBooks Create Sales Receipt node: Customer ID not configured",
      );
    }
    if (!data.lines) {
      throw new NonRetriableError(
        "QuickBooks Create Sales Receipt node: Lines not configured",
      );
    }

    const where = "QuickBooks Create Sales Receipt node";
    const connection = resolveQboConnection(credentials?.credentialId, where);

    const customerId = resolve(data.customerId).trim();
    if (!/^\d+$/.test(customerId)) {
      // Almost always an expression pointing at the wrong field — the customer
      // object rather than its id. QBO's own error for this names the whole
      // document, not the reference.
      throw new NonRetriableError(
        `${where}: "${customerId}" is not a QuickBooks customer id. Ids are numeric — point this at the id field, not the customer object.`,
      );
    }

    const document = await createSalesReceipt(connection, {
      customerId,
      lines: parseQboLines(resolve(data.lines), where),
      email: data.email ? resolve(data.email).trim() || undefined : undefined,
      depositToAccountId: data.depositToAccountId
        ? resolve(data.depositToAccountId).trim() || undefined
        : undefined,
      docNumber: data.docNumber
        ? resolve(data.docNumber).trim() || undefined
        : undefined,
      customerMemo: data.customerMemo
        ? resolve(data.customerMemo).trim() || undefined
        : undefined,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: document.Id,
        docNumber: document.DocNumber ?? null,
        total: document.TotalAmt ?? null,
        balance: document.Balance ?? null,
        txnDate: document.TxnDate ?? null,
        salesReceipt: document,
      },
    };
  });
