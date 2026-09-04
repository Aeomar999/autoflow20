import "server-only";
import { NonRetriableError } from "inngest";
import {
  sanitizeFilename,
  storeFile,
} from "@/features/files/server/file-service";
import {
  HtmlToPdfError,
  type PageOrientation,
  type PageSize,
  renderHtmlToPdf,
} from "@/features/files/server/html-to-pdf";
import type { NodeRun } from "@/nodes/types";

type HtmlToPdfData = {
  variableName?: string;
  html?: string;
  filename?: string;
  pageSize?: PageSize;
  orientation?: PageOrientation;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  header?: string;
  footer?: string;
  font?: "Helvetica" | "Times" | "Courier";
};

export const execute: NodeRun<HtmlToPdfData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  executionId,
  workflowId,
}) =>
  step.run("html-to-pdf", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "HTML to PDF node: Variable name not configured",
      );
    }
    if (!data.html) {
      throw new NonRetriableError("HTML to PDF node: No HTML configured");
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "HTML to PDF node: this run has no organization, so the PDF cannot be stored.",
      );
    }

    let bytes: Buffer;
    try {
      bytes = await renderHtmlToPdf({
        html: resolve(data.html),
        pageSize: data.pageSize,
        orientation: data.orientation,
        margins: [
          data.marginLeft ?? 40,
          data.marginTop ?? 40,
          data.marginRight ?? 40,
          data.marginBottom ?? 40,
        ],
        header: data.header ? resolve(data.header) : undefined,
        footer: data.footer ? resolve(data.footer) : undefined,
        font: data.font,
      });
    } catch (error) {
      if (error instanceof HtmlToPdfError) {
        // Everything this throws is a document the caller must change; a
        // second attempt renders the same input to the same failure.
        throw new NonRetriableError(`HTML to PDF node: ${error.message}`);
      }
      throw error;
    }

    const filename = sanitizeFilename(
      data.filename ? resolve(data.filename) : "document.pdf",
    );

    const file = await storeFile({
      organizationId,
      executionId: executionId ?? null,
      workflowId: workflowId ?? null,
      filename: filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename}.pdf`,
      mimeType: "application/pdf",
      data: bytes,
    });

    // Only the reference travels (ADR-0025); the bytes stay in the blob store.
    return {
      ...context,
      [data.variableName]: { file, bytes: bytes.byteLength },
    };
  });
