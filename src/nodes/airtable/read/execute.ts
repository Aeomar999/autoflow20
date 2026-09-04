import "server-only";
import { NonRetriableError } from "inngest";
import { listAirtableRecords } from "@/features/airtable/server/airtable-client";
import type { NodeRun } from "@/nodes/types";

type AirtableReadData = {
  variableName?: string;
  credentialId?: string;
  baseId?: string;
  tableId?: string;
  filterByFormula?: string;
  view?: string;
  sortField?: string;
  sortDirection?: "asc" | "desc";
  limit?: number;
};

export const execute: NodeRun<AirtableReadData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("airtable-read", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Airtable Read node: Variable name not configured",
      );
    }
    if (!data.baseId || !data.tableId) {
      throw new NonRetriableError(
        "Airtable Read node: Base and table must be configured",
      );
    }

    const where = "Airtable Read node";

    const { records, truncated } = await listAirtableRecords({
      secret: credentials?.credentialId,
      baseId: resolve(data.baseId).trim(),
      table: resolve(data.tableId).trim(),
      filterByFormula: data.filterByFormula
        ? resolve(data.filterByFormula).trim()
        : undefined,
      view: data.view ? resolve(data.view).trim() : undefined,
      sortField: data.sortField ? resolve(data.sortField).trim() : undefined,
      sortDirection: data.sortDirection,
      limit: data.limit ?? 100,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        records: records.map((record) => ({
          id: record.id,
          createdTime: record.createdTime ?? null,
          fields: record.fields,
        })),
        count: records.length,
        // Reported rather than implied: a workflow that read the first hundred
        // of a thousand rows looks like it read them all.
        truncated,
        // The common shape downstream: the first match, for a lookup.
        first: records[0]
          ? { id: records[0].id, fields: records[0].fields }
          : null,
        found: records.length > 0,
      },
    };
  });
