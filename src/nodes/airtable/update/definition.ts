import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  variableName: variableNameSchema.optional(),
  credentialId: credentialIdRef(),
  baseId: freeText(2048).optional(),
  tableId: freeText(2048).optional(),
  /** The record id, e.g. `{{lookup.first.id}}`. */
  recordId: freeText(256).optional(),
  /** JSON object of field name to value. Only these fields change. */
  fields: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "AIRTABLE_UPDATE",
  version: 1,
  category: "ACTION",
  label: "Airtable Update Record",
  description:
    "Update named fields on one record, leaving the rest alone. Type coercion is off, so a value that does not fit the column fails rather than inventing a new select option.",
  icon: "PenSquare",
  logo: "/logos/airtable.png",
  keywords: ["airtable", "update", "record", "patch", "edit", "base"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "airtable.apiKey", required: true },
  ],
  docsUrl: "/docs/nodes/AIRTABLE_UPDATE",
};
