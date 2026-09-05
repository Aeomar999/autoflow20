import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { readFile } from "@/features/files/server/file-service";
import {
  isQboEntity,
  type QboEntity,
} from "@/features/quickbooks/entity-names";
import { attachFile } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";

type QboAttachData = {
  variableName?: string;
  credentialId?: string;
  entity?: QboEntity;
  entityId?: string;
  file?: string;
  includeOnSend?: boolean;
};

export const execute: NodeRun<QboAttachData> = async ({
  data,
  context,
  resolve,
  step,
  organizationId,
  credentials,
}) =>
  step.run("qbo-attach", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Attach File node: Variable name not configured",
      );
    }
    if (!data.entity || !isQboEntity(data.entity)) {
      throw new NonRetriableError(
        "QuickBooks Attach File node: Record type not configured",
      );
    }
    if (!data.entityId) {
      throw new NonRetriableError(
        "QuickBooks Attach File node: Record ID not configured",
      );
    }
    if (!data.file) {
      throw new NonRetriableError(
        "QuickBooks Attach File node: File not configured",
      );
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "QuickBooks Attach File node: this run has no organization, so the file cannot be read.",
      );
    }

    const where = "QuickBooks Attach File node";
    const connection = resolveQboConnection(credentials?.credentialId, where);

    let parsed: unknown;
    try {
      parsed = JSON.parse(resolve(data.file).trim());
    } catch {
      throw new NonRetriableError(
        `${where}: the file expression did not resolve to a file reference. Use three braces — {{{json downloaded.file}}} — rather than two.`,
      );
    }

    const refs = collectFileRefs(parsed);
    if (refs.length === 0) {
      throw new NonRetriableError(
        `${where}: the file expression resolved to no file reference.`,
      );
    }
    if (refs.length > 1) {
      // QuickBooks takes one file per upload part, and silently attaching only
      // the first would lose the rest with no error to notice.
      throw new NonRetriableError(
        `${where}: the file expression resolved to ${refs.length} files. Attach one per node.`,
      );
    }

    // Org-scoped (ADR-0025): a FileRef is a plain object a CODE node could
    // mint, so the id alone is not authorization.
    const file = await readFile({
      fileId: refs[0].$file.id,
      organizationId,
    });

    const attachment = await attachFile(connection, {
      entity: data.entity,
      entityId: resolve(data.entityId).trim(),
      filename: file.filename,
      mimeType: file.mimeType,
      data: file.data,
      includeOnSend: data.includeOnSend ?? false,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        attachmentId: attachment.Id,
        filename: attachment.FileName ?? file.filename,
        entity: data.entity,
        bytes: file.data.byteLength,
      },
    };
  });
