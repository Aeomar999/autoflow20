import "server-only";
import { listAirtableRecords } from "@/features/airtable/server/airtable-client";
import type { PollingTrigger } from "@/nodes/types";

type AirtableTriggerConfig = {
  baseId?: string;
  tableId?: string;
  view?: string;
  filterByFormula?: string;
  modifiedField?: string;
};

/**
 * `AIRTABLE_TRIGGER`'s poller (AF-M10-20 on the AF-M10-05 framework).
 *
 * The framework owns dispatch, dedupe, the cursor and the no-history-replay
 * rule. This answers one question — which records should be considered — and
 * gives each an id.
 *
 * **The id is what decides whether an EDIT fires the workflow.** With no
 * modified field the id is the record id, so a record is seen once and never
 * again. Point the node at a last-modified column and the id becomes
 * `recordId@timestamp`, so an edit is a new id and fires; a record that has not
 * changed keeps the same id and does not. That is the whole difference between
 * "new records" and "new or changed records", and it costs one config field
 * rather than a second node type.
 */
export const polling: PollingTrigger<AirtableTriggerConfig> = {
  defaultIntervalSeconds: 300,

  async poll({ config, credentials, limit }) {
    if (!config.baseId || !config.tableId) {
      throw new Error("Airtable trigger: base and table must be configured.");
    }

    const modifiedField = config.modifiedField?.trim();

    const { records } = await listAirtableRecords({
      secret: credentials?.credentialId,
      baseId: config.baseId,
      table: config.tableId,
      filterByFormula: config.filterByFormula?.trim() || undefined,
      view: config.view?.trim() || undefined,
      // Newest first when there is a modified field, so a busy table's recent
      // changes are what a bounded read sees.
      sortField: modifiedField,
      sortDirection: modifiedField ? "desc" : undefined,
      // Read wider than one dispatch window: the framework caps what it
      // dispatches, and reading exactly `limit` would make a backlog look like
      // the whole table.
      limit: Math.max(limit * 4, 100),
      where: "Airtable trigger",
    });

    const items = records.map((record) => {
      const modifiedAt = modifiedField
        ? String(record.fields[modifiedField] ?? "")
        : "";

      return {
        id: modifiedAt ? `${record.id}@${modifiedAt}` : record.id,
        data: {
          record: {
            id: record.id,
            createdTime: record.createdTime ?? null,
            fields: record.fields,
          },
          table: { baseId: config.baseId, tableId: config.tableId },
        },
      };
    });

    return {
      items,
      // The framework's id window is the dedupe mechanism; there is no
      // server-side cursor to keep, because Airtable's formula filter and the
      // view are what narrow the read.
      cursor: { lastPolledAt: new Date().toISOString() },
    };
  },
};
