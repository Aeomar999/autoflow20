import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import { uploadJiraAttachment } from "@/features/jira/server/jira-attachment";
import type { NodeRun } from "@/nodes/types";

type JiraAddAttachmentData = {
  variableName?: string;
  credentialId?: string;
  issueKey?: string;
  fileRef?: string;
  fileName?: string;
};

export const execute: NodeRun<JiraAddAttachmentData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  organizationId,
}) =>
  step.run("jira-add-attachment", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Jira Add Attachment node: Variable name not configured",
      );
    }
    if (!data.issueKey) {
      throw new NonRetriableError(
        "Jira Add Attachment node: Issue key not configured",
      );
    }
    if (!data.fileRef) {
      throw new NonRetriableError(
        "Jira Add Attachment node: No file configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Jira Add Attachment node: this run has no organization, so its files cannot be read.",
      );
    }

    const where = "Jira Add Attachment node";
    const rendered = resolve(data.fileRef).trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch {
      throw new NonRetriableError(
        `${where}: the file expression did not resolve to a file reference. Use three braces — {{{json report.file}}} — rather than two.`,
      );
    }

    const refs = collectFileRefs(parsed);
    if (refs.length === 0) {
      throw new NonRetriableError(
        `${where}: the file expression resolved to a value containing no file reference.`,
      );
    }
    if (refs.length > 1) {
      // Attaching only the first would silently drop the rest.
      throw new NonRetriableError(
        `${where}: the file expression resolved to ${refs.length} files. This node attaches one — put it inside a Split Out segment to attach several.`,
      );
    }

    const stored = await readFile({
      fileId: refs[0].$file.id,
      organizationId,
    });

    const issueKey = resolve(data.issueKey).trim().toUpperCase();

    const attachments = await uploadJiraAttachment({
      secret: credentials?.credentialId,
      issueKey,
      filename: data.fileName ? resolve(data.fileName).trim() : stored.filename,
      mimeType: stored.mimeType,
      data: stored.data,
      where,
    });

    const first = attachments[0];

    return {
      ...context,
      [data.variableName]: {
        issueKey,
        attachmentId: first?.id ?? null,
        filename: first?.filename ?? stored.filename,
        size: first?.size ?? stored.data.byteLength,
      },
    };
  });
