import "server-only";
import { NonRetriableError } from "inngest";
import type { QboLineInput } from "@/nodes/quickbooks/shared";
import { QBO_ENTITIES, type QboEntity } from "../entity-names";
import {
  escapeQboQuery,
  type QboConnection,
  qboFetch,
  qboFetchBytes,
  qboQuery,
  qboUpload,
} from "./qbo-client";

/**
 * QBO entity operations (AF-M10-16).
 *
 * The shapes the reference automations actually need: find or create a
 * customer, raise an invoice/estimate/sales receipt, record an expense, read a
 * record back, fetch an invoice PDF, and attach a file to a record.
 */

/** Invoice PDFs are a few hundred KB; a 25 MB one is a bug, not a document. */
export const MAX_QBO_PDF_BYTES = 25 * 1024 * 1024;

/** Attachment ceiling. Intuit's own limit is 100 MB per file. */
export const MAX_QBO_ATTACHMENT_BYTES = 50 * 1024 * 1024;

// The entity map lives in the isomorphic module: node definitions build their
// dropdown from it on the client, and this file is server-only.
export {
  isQboEntity,
  QBO_ENTITIES,
  type QboEntity,
} from "../entity-names";

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Active?: boolean;
  SyncToken?: string;
}

/**
 * Find a customer by display name or email.
 *
 * Returns `null` rather than throwing when there is no match: "no such
 * customer" is the *expected* answer in every find-or-create flow, and a node
 * that failed the run would make the create branch unreachable.
 */
export async function findCustomer(
  connection: QboConnection,
  args: { displayName?: string; email?: string; where: string },
): Promise<{ customer: QboCustomer | null; matches: number }> {
  const clauses: string[] = [];
  if (args.displayName) {
    clauses.push(`DisplayName = '${escapeQboQuery(args.displayName)}'`);
  }
  if (args.email) {
    clauses.push(`PrimaryEmailAddr = '${escapeQboQuery(args.email)}'`);
  }

  if (clauses.length === 0) {
    throw new NonRetriableError(
      `${args.where}: give a display name or an email to search by. A search with neither would return the whole customer list.`,
    );
  }

  const { items } = await qboQuery<QboCustomer>(connection, {
    // OR, not AND: the two are alternative ways of naming the same person, and
    // requiring both would miss a customer whose email is not on file.
    select: `SELECT * FROM Customer WHERE ${clauses.join(" OR ")}`,
    entity: "Customer",
    limit: 10,
    where: args.where,
  });

  return { customer: items[0] ?? null, matches: items.length };
}

export async function createCustomer(
  connection: QboConnection,
  args: {
    displayName: string;
    email?: string;
    phone?: string;
    companyName?: string;
    where: string;
  },
): Promise<QboCustomer> {
  const body: Record<string, unknown> = { DisplayName: args.displayName };
  if (args.email) body.PrimaryEmailAddr = { Address: args.email };
  if (args.phone) body.PrimaryPhone = { FreeFormNumber: args.phone };
  if (args.companyName) body.CompanyName = args.companyName;

  const response = await qboFetch<{ Customer?: QboCustomer }>(connection, {
    path: "customer",
    method: "POST",
    body,
    where: args.where,
  });

  if (!response?.Customer) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the request but returned no customer.`,
    );
  }
  return response.Customer;
}

// Declared with the parser that produces it, in the isomorphic node module.
export type { QboLineInput } from "@/nodes/quickbooks/shared";

/**
 * Build QBO's `Line` array.
 *
 * Every line is `SalesItemLineDetail`, which is what makes a line appear on the
 * document with a description and a price. The alternative QBO accepts —
 * a bare `Amount` with no detail — posts to the ledger and renders as a blank
 * row on the PDF the customer receives.
 */
function buildSalesLines(lines: QboLineInput[], where: string): unknown[] {
  if (lines.length === 0) {
    throw new NonRetriableError(
      `${where}: at least one line is required. QuickBooks rejects a document with no lines, and an empty invoice is never what was meant.`,
    );
  }

  return lines.map((line, index) => {
    if (!Number.isFinite(line.amount)) {
      throw new NonRetriableError(
        `${where}: line ${index + 1} has no usable amount. Check the expression that produces it — a blank cell resolves to an empty string, not to zero.`,
      );
    }

    const detail: Record<string, unknown> = {};
    if (line.itemId) detail.ItemRef = { value: line.itemId };
    if (line.quantity !== undefined) detail.Qty = line.quantity;
    if (line.unitPrice !== undefined) detail.UnitPrice = line.unitPrice;

    return {
      DetailType: "SalesItemLineDetail",
      // Rounded to cents. A quantity times a unit price in floating point
      // produces 41.980000000000004, which QBO stores and then renders on a
      // customer-facing PDF.
      Amount: Math.round(line.amount * 100) / 100,
      ...(line.description ? { Description: line.description } : {}),
      SalesItemLineDetail: detail,
    };
  });
}

interface SalesDocumentArgs {
  customerId: string;
  lines: QboLineInput[];
  email?: string;
  dueDate?: string;
  docNumber?: string;
  customerMemo?: string;
  where: string;
}

const salesDocumentBody = (
  args: SalesDocumentArgs,
): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    CustomerRef: { value: args.customerId },
    Line: buildSalesLines(args.lines, args.where),
  };
  if (args.email) {
    body.BillEmail = { Address: args.email };
  }
  if (args.dueDate) body.DueDate = args.dueDate;
  if (args.docNumber) body.DocNumber = args.docNumber;
  if (args.customerMemo) body.CustomerMemo = { value: args.customerMemo };
  return body;
};

export interface QboSalesDocument {
  Id: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  TxnDate?: string;
  SyncToken?: string;
}

export async function createInvoice(
  connection: QboConnection,
  args: SalesDocumentArgs,
): Promise<QboSalesDocument> {
  const response = await qboFetch<{ Invoice?: QboSalesDocument }>(connection, {
    path: "invoice",
    method: "POST",
    body: salesDocumentBody(args),
    where: args.where,
  });
  if (!response?.Invoice) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the request but returned no invoice.`,
    );
  }
  return response.Invoice;
}

export async function createEstimate(
  connection: QboConnection,
  args: SalesDocumentArgs,
): Promise<QboSalesDocument> {
  const response = await qboFetch<{ Estimate?: QboSalesDocument }>(connection, {
    path: "estimate",
    method: "POST",
    body: salesDocumentBody(args),
    where: args.where,
  });
  if (!response?.Estimate) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the request but returned no estimate.`,
    );
  }
  return response.Estimate;
}

export async function createSalesReceipt(
  connection: QboConnection,
  args: SalesDocumentArgs & { depositToAccountId?: string },
): Promise<QboSalesDocument> {
  const body = salesDocumentBody(args);
  if (args.depositToAccountId) {
    body.DepositToAccountRef = { value: args.depositToAccountId };
  }

  const response = await qboFetch<{ SalesReceipt?: QboSalesDocument }>(
    connection,
    {
      path: "salesreceipt",
      method: "POST",
      body,
      where: args.where,
    },
  );
  if (!response?.SalesReceipt) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the request but returned no sales receipt.`,
    );
  }
  return response.SalesReceipt;
}

/**
 * Record an expense.
 *
 * QBO calls this a `Purchase`, which is the name people search the API docs
 * for and never the word on the screen that sent them there.
 */
export async function createExpense(
  connection: QboConnection,
  args: {
    /** Bank or credit-card account the money left. */
    paymentAccountId: string;
    paymentType: "Cash" | "Check" | "CreditCard";
    /** Expense account the cost is booked to. */
    expenseAccountId: string;
    amount: number;
    vendorId?: string;
    txnDate?: string;
    description?: string;
    where: string;
  },
): Promise<{ Id: string; TotalAmt?: number; TxnDate?: string }> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) {
    throw new NonRetriableError(
      `${args.where}: an expense needs a positive amount. QuickBooks accepts a zero-amount purchase and it is never what was meant.`,
    );
  }

  const body: Record<string, unknown> = {
    AccountRef: { value: args.paymentAccountId },
    PaymentType: args.paymentType,
    Line: [
      {
        DetailType: "AccountBasedExpenseLineDetail",
        Amount: Math.round(args.amount * 100) / 100,
        ...(args.description ? { Description: args.description } : {}),
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: args.expenseAccountId },
        },
      },
    ],
  };
  if (args.vendorId) body.EntityRef = { value: args.vendorId, type: "Vendor" };
  if (args.txnDate) body.TxnDate = args.txnDate;

  const response = await qboFetch<{
    Purchase?: { Id: string; TotalAmt?: number; TxnDate?: string };
  }>(connection, {
    path: "purchase",
    method: "POST",
    body,
    where: args.where,
  });

  if (!response?.Purchase) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the request but returned no expense.`,
    );
  }
  return response.Purchase;
}

/** Read one record by id. */
export async function getEntity(
  connection: QboConnection,
  args: { entity: QboEntity; id: string; where: string },
): Promise<Record<string, unknown>> {
  if (!/^\d+$/.test(args.id)) {
    // QBO ids are numeric strings. Rejecting here keeps a templated value that
    // resolved to something odd out of the URL path entirely.
    throw new NonRetriableError(
      `${args.where}: "${args.id}" is not a QuickBooks id. Ids are numeric — check the expression that produced this one.`,
    );
  }

  const response = await qboFetch<Record<string, unknown>>(connection, {
    path: `${QBO_ENTITIES[args.entity]}/${args.id}`,
    where: args.where,
  });

  const record = response?.[args.entity];
  if (!record || typeof record !== "object") {
    throw new NonRetriableError(
      `${args.where}: QuickBooks returned no ${args.entity} for id ${args.id}.`,
    );
  }
  return record as Record<string, unknown>;
}

/** An invoice rendered as a PDF, as QBO's own "send" would produce it. */
export async function getInvoicePdf(
  connection: QboConnection,
  args: { invoiceId: string; where: string },
): Promise<Buffer> {
  if (!/^\d+$/.test(args.invoiceId)) {
    throw new NonRetriableError(
      `${args.where}: "${args.invoiceId}" is not a QuickBooks invoice id. Ids are numeric.`,
    );
  }

  return qboFetchBytes(connection, {
    path: `invoice/${args.invoiceId}/pdf`,
    // Without this header QBO answers with JSON metadata and the node stores a
    // "PDF" that no reader will open.
    accept: "application/pdf",
    maxBytes: MAX_QBO_PDF_BYTES,
    where: args.where,
  });
}

/**
 * Attach a file to a record.
 *
 * The `/upload` endpoint is multipart and takes two parts: the `Attachable`
 * metadata as JSON and the bytes, related by a part name QBO matches on
 * (`file_content_0` pairs with `file_metadata_0`). Getting the pairing wrong
 * uploads the file with no link to the record, which reads as success and
 * leaves an orphan in the company's attachment list.
 */
export async function attachFile(
  connection: QboConnection,
  args: {
    entity: QboEntity;
    entityId: string;
    filename: string;
    mimeType: string;
    data: Buffer;
    /** Also attach to the emailed copy of the document. */
    includeOnSend?: boolean;
    where: string;
  },
): Promise<{ Id: string; FileName?: string }> {
  if (args.data.byteLength > MAX_QBO_ATTACHMENT_BYTES) {
    throw new NonRetriableError(
      `${args.where}: the attachment is ${args.data.byteLength} bytes, over the ${MAX_QBO_ATTACHMENT_BYTES}-byte limit for this node.`,
    );
  }

  const metadata = {
    AttachableRef: [
      {
        EntityRef: { type: args.entity, value: args.entityId },
        IncludeOnSend: args.includeOnSend ?? false,
      },
    ],
    FileName: args.filename,
    ContentType: args.mimeType,
  };

  const boundary = `----autoflow_qbo_${Date.now().toString(36)}`;
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file_metadata_0"\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file_content_0"; filename="${args.filename.replace(/["\r\n]/g, "")}"\r\n` +
        `Content-Type: ${args.mimeType}\r\n\r\n`,
      "utf-8",
    ),
    args.data,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"),
  ]);

  const parsed = await qboUpload<{
    AttachableResponse?: Array<{
      Attachable?: { Id: string; FileName?: string };
      Fault?: { Error?: Array<{ Message?: string; Detail?: string }> };
    }>;
  }>(connection, { body, boundary, where: args.where });

  const first = parsed.AttachableResponse?.[0];
  // The upload endpoint reports per-part failures inside a 200. Without this
  // check a rejected attachment is indistinguishable from a stored one.
  if (first?.Fault) {
    const error = first.Fault.Error?.[0];
    throw new NonRetriableError(
      `${args.where}: QuickBooks rejected the attachment: ${error?.Message ?? "unknown"}${error?.Detail ? ` — ${error.Detail}` : ""}`,
    );
  }
  if (!first?.Attachable) {
    throw new NonRetriableError(
      `${args.where}: QuickBooks accepted the upload but returned no attachment record.`,
    );
  }
  return first.Attachable;
}
