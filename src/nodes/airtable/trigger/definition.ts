import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { credentialIdRef, freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  credentialId: credentialIdRef(),
  baseId: freeText(2048).optional(),
  tableId: freeText(2048).optional(),
  view: freeText(256).optional(),
  filterByFormula: freeText(4096).optional(),
  /**
   * Field holding a last-modified time. With one, an edited record fires
   * again; without one, only new records do.
   */
  modifiedField: freeText(256).optional(),
  pollIntervalSeconds: z.number().int().min(60).max(86_400).optional(),
});

export const definition: NodeDefinition = {
  type: "AIRTABLE_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Airtable Trigger",
  description:
    "Start a workflow when a record appears in a table — or changes, if you point it at a last-modified field. Activating never replays existing rows.",
  icon: "Table",
  logo: "/logos/airtable.png",
  keywords: ["airtable", "trigger", "record", "new", "changed", "poll"],
  configSchema,
  defaults: { pollIntervalSeconds: 300 },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "airtable.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/AIRTABLE_TRIGGER",
};
