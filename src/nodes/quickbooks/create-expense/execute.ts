import "server-only";
import { NonRetriableError } from "inngest";
import { createExpense } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";
import { parseQboAmount } from "../parse";

type QboCreateExpenseData = {
  variableName?: string;
  credentialId?: string;
  paymentAccountId?: string;
  paymentType?: "Cash" | "Check" | "CreditCard";
  expenseAccountId?: string;
  amount?: string;
  vendorId?: string;
  txnDate?: string;
  description?: string;
};

export const execute: NodeRun<QboCreateExpenseData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("qbo-create-expense", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Create Expense node: Variable name not configured",
      );
    }
    if (!data.paymentAccountId) {
      throw new NonRetriableError(
        "QuickBooks Create Expense node: Payment account not configured",
      );
    }
    if (!data.expenseAccountId) {
      throw new NonRetriableError(
        "QuickBooks Create Expense node: Expense account not configured",
      );
    }
    if (!data.amount) {
      throw new NonRetriableError(
        "QuickBooks Create Expense node: Amount not configured",
      );
    }

    const where = "QuickBooks Create Expense node";
    const connection = resolveQboConnection(credentials?.credentialId, where);

    const amount = parseQboAmount(resolve(data.amount), where);

    const expense = await createExpense(connection, {
      paymentAccountId: resolve(data.paymentAccountId).trim(),
      paymentType: data.paymentType ?? "CreditCard",
      expenseAccountId: resolve(data.expenseAccountId).trim(),
      amount,
      vendorId: data.vendorId
        ? resolve(data.vendorId).trim() || undefined
        : undefined,
      txnDate: data.txnDate
        ? resolve(data.txnDate).trim() || undefined
        : undefined,
      description: data.description
        ? resolve(data.description).trim() || undefined
        : undefined,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: expense.Id,
        total: expense.TotalAmt ?? amount,
        txnDate: expense.TxnDate ?? null,
        expense,
      },
    };
  });
