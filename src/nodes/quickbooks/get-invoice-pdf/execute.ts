import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import {
  getEntity,
  getInvoicePdf,
} from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";

type QboInvoicePdfData = {
  variableName?: string;
  credentialId?: string;
  invoiceId?: string;
  filename?: string;
};

export const execute: NodeRun<QboInvoicePdfData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  executionId,
  workflowId,
  credentials,
}) =>
  step.run("qbo-invoice-pdf", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Invoice PDF node: Variable name not configured",
      );
    }
    if (!data.invoiceId) {
      throw new NonRetriableError(
        "QuickBooks Invoice PDF node: Invoice ID not configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "QuickBooks Invoice PDF node: this run has no organization, so the PDF cannot be stored.",
      );
    }

    const where = "QuickBooks Invoice PDF node";
    const connection = resolveQboConnection(credentials?.credentialId, where);
    const invoiceId = resolve(data.invoiceId).trim();

    const pdf = await getInvoicePdf(connection, { invoiceId, where });

    let filename = data.filename ? resolve(data.filename).trim() : "";
    if (!filename) {
      // The invoice number is what a person filing this PDF recognises;
      // "Invoice-142.pdf" beats "Invoice-1043968512.pdf" in a Drive folder.
      // Worth one extra read, and it degrades to the id if that read is thin.
      const invoice = await getEntity(connection, {
        entity: "Invoice",
        id: invoiceId,
        where,
      });
      const docNumber =
        typeof invoice.DocNumber === "string" && invoice.DocNumber.length > 0
          ? invoice.DocNumber
          : invoiceId;
      filename = `Invoice-${docNumber}.pdf`;
    }
    if (!filename.toLowerCase().endsWith(".pdf")) {
      filename = `${filename}.pdf`;
    }

    const ref = await storeFile({
      organizationId,
      executionId: executionId ?? null,
      workflowId: workflowId ?? null,
      filename,
      mimeType: "application/pdf",
      data: pdf,
    });

    return {
      ...context,
      [data.variableName]: {
        file: ref,
        invoiceId,
        filename,
        bytes: pdf.byteLength,
      },
    };
  });
