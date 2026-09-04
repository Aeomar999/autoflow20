import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.id}} */
  variableName: variableNameSchema.optional(),
  /** Airtable PAT credential (Bearer token for api.airtable.com). */
  credentialId: credentialIdRef(),
  /** The base (app) id, e.g. "appXXXXXX", or encoded base name. */
  baseId: freeText(2048).optional(),
  /** Table id ("tblXXXXXX") or table name. */
  tableId: freeText(2048).optional(),
  /**
   * JSON object of field name to value for the new record. String values are
   * template-compiled at run time; numbers, booleans, null, and arrays pass
   * through.
   */
  fields: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "AIRTABLE_CREATE_RECORD",
  version: 1,
  category: "ACTION",
  label: "Airtable Create Record",
  description:
    "Create a record in an Airtable table and store the created record.",
  icon: "Table",
  logo: "/logos/airtable.png",
  keywords: ["airtable", "create", "record", "base", "table", "row"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [
    { key: "credentialId", type: "airtable.apiKey", required: true },
  ],
};
