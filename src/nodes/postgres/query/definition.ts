import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  credentialIdRef,
  freeText,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.rows}} */
  variableName: variableNameSchema.optional(),
  /** Postgres credential (host, port, database, username, password, ssl). */
  credentialId: credentialIdRef(),
  /**
   * Static SQL with $1, $2, ... placeholders. Never template-compiled:
   * variable values must flow through `params` as bound parameters, not be
   * concatenated into the statement.
   */
  query: freeText(65_536).optional(),
  /**
   * JSON array of values bound positionally to the query placeholders.
   * String entries are template-compiled at run time and bound as parameters.
   */
  params: freeText(65_536).optional(),
});

export const definition: NodeDefinition = {
  type: "POSTGRES_QUERY",
  version: 1,
  category: "ACTION",
  label: "Postgres Query",
  description:
    "Run a parameterized SQL query against a PostgreSQL database and store the rows.",
  icon: "Database",
  keywords: ["postgres", "postgresql", "sql", "database", "query", "pg"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  credentials: [{ key: "credentialId", type: "postgres", required: true }],
};
