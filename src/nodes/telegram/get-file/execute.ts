import "server-only";
import { NonRetriableError } from "inngest";
import { storeFile } from "@/features/files/server/file-service";
import { downloadTelegramFile } from "@/features/telegram/server/telegram-client";
import type { NodeRun } from "@/nodes/types";

type TelegramGetFileData = {
  variableName?: string;
  credentialId?: string;
  fileId?: string;
  fileName?: string;
};

export const execute: NodeRun<TelegramGetFileData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  organizationId,
  executionId,
  workflowId,
}) =>
  step.run("telegram-get-file", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Telegram Get File node: Variable name not configured",
      );
    }
    if (!data.fileId) {
      throw new NonRetriableError(
        "Telegram Get File node: File id not configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Telegram Get File node: this run has no organization, so a file cannot be stored for it.",
      );
    }

    const where = "Telegram Get File node";
    const fileId = resolve(data.fileId).trim();

    if (fileId.length === 0) {
      // Almost always a trigger message that carried no attachment, so
      // `telegram.fileId` resolved to nothing.
      throw new NonRetriableError(
        `${where}: the file id resolved to nothing. If it comes from a Telegram trigger, that message may not have had an attachment — branch on {{telegram.fileId}} first.`,
      );
    }

    const downloaded = await downloadTelegramFile({
      secret: credentials?.credentialId,
      fileId,
      where,
    });

    const file = await storeFile({
      organizationId,
      executionId,
      workflowId,
      filename: data.fileName
        ? resolve(data.fileName).trim()
        : downloaded.filename,
      mimeType: downloaded.mimeType,
      data: downloaded.data,
    });

    return {
      ...context,
      [data.variableName]: {
        // A FileRef, so Drive Upload, Jira Add Attachment and Gmail Send can
        // all take it directly with {{{json ….file}}}.
        file,
        filename: downloaded.filename,
        mimeType: downloaded.mimeType,
        size: downloaded.size,
      },
    };
  });
