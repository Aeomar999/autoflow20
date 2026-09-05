import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import {
  downloadDriveFile,
  getDriveFile,
} from "@/features/google/server/drive";
import type { NodeRun } from "@/nodes/types";

type DriveDownloadData = {
  variableName?: string;
  credentialId?: string;
  fileId?: string;
  maxBytes?: number;
};

export const execute: NodeRun<DriveDownloadData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  executionId,
  workflowId,
  credentials,
}) =>
  step.run("drive-download", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Drive Download node: Variable name not configured",
      );
    }
    if (!data.fileId) {
      throw new NonRetriableError(
        "Drive Download node: File ID not configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Drive Download node: this run has no organization, so the file cannot be stored.",
      );
    }

    const secret = credentials?.credentialId;
    const where = "Drive Download node";

    const file = await getDriveFile({
      secret,
      fileId: resolve(data.fileId).trim(),
      where,
    });

    const downloaded = await downloadDriveFile({
      secret,
      file,
      maxBytes: data.maxBytes,
      where,
    });

    const ref = await storeFile({
      organizationId,
      executionId: executionId ?? null,
      workflowId: workflowId ?? null,
      filename: downloaded.filename,
      mimeType: downloaded.mimeType,
      data: downloaded.data,
    });

    return {
      ...context,
      [data.variableName]: {
        file: ref,
        driveFileId: file.id,
        name: file.name,
        // A Google Doc came back as a .docx, not as itself. Saying so keeps a
        // downstream "why is this a Word file?" from being a mystery.
        exported: downloaded.exported,
        mimeType: downloaded.mimeType,
        bytes: downloaded.data.byteLength,
      },
    };
  });
