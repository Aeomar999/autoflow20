import "server-only";
import { NonRetriableError } from "inngest";
import { downloadToFile } from "@/features/files/server/file-service";
import { buildHttpAuth, type HttpAuthMode } from "@/nodes/shared/http-auth";
import type { NodeRun } from "@/nodes/types";

type FileDownloadData = {
  variableName?: string;
  url?: string;
  filename?: string;
  credentialId?: string;
  authMode?: HttpAuthMode;
  authHeaderName?: string;
  authQueryParam?: string;
  maxBytes?: number;
};

export const execute: NodeRun<FileDownloadData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  credentials,
}) =>
  step.run("file-download", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Download File node: Variable name not configured",
      );
    }
    if (!data.url) {
      throw new NonRetriableError("Download File node: URL not configured");
    }
    if (!organizationId) {
      // Files are org-scoped by construction. A run with no org has nowhere to
      // put one, and guessing would create a file no read path could reach.
      throw new NonRetriableError(
        "Download File node: this run has no organization, so files cannot be stored.",
      );
    }

    // Auth is built from the resolved credential map only (AF-M10-01) —
    // `data` is persisted as NodeExecution.input.
    const auth = buildHttpAuth(data.authMode, credentials?.credentialId, {
      headerName: data.authHeaderName
        ? resolve(data.authHeaderName)
        : undefined,
      queryParamName: data.authQueryParam
        ? resolve(data.authQueryParam)
        : undefined,
    });

    const url = new URL(resolve(data.url));
    for (const [key, value] of Object.entries(auth.query)) {
      url.searchParams.set(key, value);
    }

    const fileRef = await downloadToFile({
      url: url.toString(),
      organizationId,
      filename: data.filename ? resolve(data.filename) : undefined,
      headers: auth.headers,
      maxBytes: data.maxBytes,
    });

    // Only the reference travels. The bytes stay in the blob store, which is
    // the whole point: a 5 MB PDF here would fail the ADR-0018 output bound.
    return {
      ...context,
      [data.variableName]: { file: fileRef },
    };
  });
