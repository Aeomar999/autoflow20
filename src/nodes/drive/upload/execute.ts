import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import { uploadDriveFile } from "@/features/google/server/drive";
import type { NodeRun } from "@/nodes/types";

type DriveUploadData = {
  variableName?: string;
  credentialId?: string;
  file?: string;
  folderId?: string;
  filename?: string;
};

export const execute: NodeRun<DriveUploadData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  credentials,
}) =>
  step.run("drive-upload", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Drive Upload node: Variable name not configured",
      );
    }
    if (!data.file) {
      throw new NonRetriableError("Drive Upload node: No file configured");
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Drive Upload node: this run has no organization, so its files cannot be read.",
      );
    }

    const rendered = resolve(data.file).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch {
      throw new NonRetriableError(
        "Drive Upload node: the file expression did not resolve to a file reference. Use three braces — {{{json report.file}}} — rather than two.",
      );
    }

    const refs = collectFileRefs(parsed);
    if (refs.length === 0) {
      throw new NonRetriableError(
        "Drive Upload node: the file expression resolved to a value containing no file reference.",
      );
    }
    if (refs.length > 1) {
      // Uploading only the first would silently drop the rest; a user who
      // pointed this at an array meant all of them.
      throw new NonRetriableError(
        `Drive Upload node: the file expression resolved to ${refs.length} files. This node uploads one — put it inside a Split Out segment to upload several.`,
      );
    }

    const stored = await readFile({
      fileId: refs[0].$file.id,
      organizationId,
    });

    const uploaded = await uploadDriveFile({
      secret: credentials?.credentialId,
      folderId: data.folderId ? resolve(data.folderId).trim() : undefined,
      filename: data.filename ? resolve(data.filename) : stored.filename,
      mimeType: stored.mimeType,
      data: stored.data,
      where: "Drive Upload node",
    });

    return {
      ...context,
      [data.variableName]: {
        id: uploaded.id,
        name: uploaded.name,
        mimeType: uploaded.mimeType,
        webViewLink: uploaded.webViewLink,
        bytes: stored.data.byteLength,
      },
    };
  });
