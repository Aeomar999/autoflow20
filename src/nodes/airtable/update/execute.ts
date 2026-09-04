import "server-only";
import { NonRetriableError } from "inngest";
import { updateAirtableRecord } from "@/features/airtable/server/airtable-client";
import type { NodeRun } from "@/nodes/types";

type AirtableUpdateData = {
  variableName?: string;
  credentialId?: string;
  baseId?: string;
  tableId?: string;
  recordId?: string;
  fields?: string;
};

export const execute: NodeRun<AirtableUpdateData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("airtable-update", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Airtable Update node: Variable name not configured",
      );
    }
    if (!data.baseId || !data.tableId) {
      throw new NonRetriableError(
        "Airtable Update node: Base and table must be configured",
      );
    }
    if (!data.recordId) {
      throw new NonRetriableError(
        "Airtable Update node: Record id not configured",
      );
    }
    if (!data.fields) {
      throw new NonRetriableError(
        "Airtable Update node: Fields not configured",
      );
    }

    const where = "Airtable Update node";
    const recordId = resolve(data.recordId).trim();

    if (recordId.length === 0) {
      // Usually an upstream lookup that found nothing, so its `id` resolved to
      // nothing. Saying that beats Airtable's 404.
      throw new NonRetriableError(
        `${where}: the record id resolved to nothing. If it comes from a lookup, that lookup may not have matched.`,
      );
    }

    let fields: Record<string, unknown>;
    try {
      const parsed = JSON.parse(resolve(data.fields));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      fields = parsed as Record<string, unknown>;
    } catch {
      throw new NonRetriableError(
        `${where}: the fields expression did not resolve to a JSON object. Use three braces — {{{json row}}} — rather than two, which HTML-escapes the quotes.`,
      );
    }

    const record = await updateAirtableRecord({
      secret: credentials?.credentialId,
      baseId: resolve(data.baseId).trim(),
      table: resolve(data.tableId).trim(),
      recordId,
      fields,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: record.id,
        fields: record.fields,
        updatedFields: Object.keys(fields),
      },
    };
  });
