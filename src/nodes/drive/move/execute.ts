import "server-only";
import { NonRetriableError } from "inngest";
import { moveDriveFile } from "@/features/google/server/drive";
import type { NodeRun } from "@/nodes/types";

type DriveMoveData = {
  variableName?: string;
  credentialId?: string;
  fileId?: string;
  toFolderId?: string;
};

export const execute: NodeRun<DriveMoveData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("drive-move", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Drive Move node: Variable name not configured",
      );
    }
    if (!data.fileId) {
      throw new NonRetriableError("Drive Move node: File ID not configured");
    }
    if (!data.toFolderId) {
      throw new NonRetriableError(
        "Drive Move node: Destination folder not configured",
      );
    }

    const moved = await moveDriveFile({
      secret: credentials?.credentialId,
      fileId: resolve(data.fileId).trim(),
      toFolderId: resolve(data.toFolderId).trim(),
      where: "Drive Move node",
    });

    return {
      ...context,
      [data.variableName]: {
        id: moved.id,
        name: moved.name,
        parents: moved.parents,
        webViewLink: moved.webViewLink,
      },
    };
  });
