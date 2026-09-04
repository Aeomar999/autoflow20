import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import {
  buildRawMessage,
  type GmailAttachment,
  sendGmail,
} from "@/features/google/server/gmail";
import type { NodeRun } from "@/nodes/types";

type GmailSendData = {
  variableName?: string;
  credentialId?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachments?: string;
  threadId?: string;
  inReplyTo?: string;
};

export const execute: NodeRun<GmailSendData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  credentials,
}) =>
  step.run("gmail-send", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Gmail Send node: Variable name not configured",
      );
    }
    if (!data.from) {
      throw new NonRetriableError("Gmail Send node: Sender not configured");
    }
    if (!data.to) {
      throw new NonRetriableError("Gmail Send node: Recipients not configured");
    }
    if (!data.html && !data.text) {
      // An empty body is almost always a template that resolved to nothing;
      // sending it delivers a blank email that looks like a bug to the
      // recipient and like a success to the sender.
      throw new NonRetriableError(
        "Gmail Send node: no body configured. Set an HTML or plain-text body.",
      );
    }

    const attachments: GmailAttachment[] = [];
    if (data.attachments) {
      const rendered = resolve(data.attachments).trim();
      if (rendered.length > 0) {
        if (!organizationId) {
          throw new NonRetriableError(
            "Gmail Send node: this run has no organization, so its attachments cannot be read.",
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rendered);
        } catch {
          throw new NonRetriableError(
            "Gmail Send node: the attachments expression did not resolve to a file reference. Use three braces — {{{json report.file}}} — rather than two.",
          );
        }

        for (const ref of collectFileRefs(parsed)) {
          // Org-scoped (ADR-0025): a FileRef is a plain object a CODE node
          // could mint, so the id alone is not authorization.
          const file = await readFile({
            fileId: ref.$file.id,
            organizationId,
          });
          attachments.push({
            filename: file.filename,
            mimeType: file.mimeType,
            data: file.data,
          });
        }
      }
    }

    const raw = buildRawMessage({
      from: resolve(data.from),
      to: resolve(data.to),
      cc: data.cc ? resolve(data.cc) : undefined,
      bcc: data.bcc ? resolve(data.bcc) : undefined,
      subject: data.subject ? resolve(data.subject) : "(no subject)",
      html: data.html ? resolve(data.html) : undefined,
      text: data.text ? resolve(data.text) : undefined,
      attachments,
      inReplyTo: data.inReplyTo ? resolve(data.inReplyTo) : undefined,
    });

    const sent = await sendGmail({
      secret: credentials?.credentialId,
      raw,
      threadId: data.threadId ? resolve(data.threadId) : undefined,
      where: "Gmail Send node",
    });

    return {
      ...context,
      [data.variableName]: {
        id: sent.id,
        threadId: sent.threadId,
        attachmentCount: attachments.length,
      },
    };
  });
