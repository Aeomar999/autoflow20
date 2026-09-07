import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import {
  handlebarsSchema,
  variableNameSchema,
} from "../../shared/config-fields";

export const configSchema = z.object({
  action: z
    .enum(["insert", "update", "find", "find_many", "delete"])
    .default("insert"),
  tableId: z.string().default(""),
  recordId: z.string().optional(),
  data: z
    .array(
      z.object({
        key: z.string().min(1),
        value: handlebarsSchema,
      }),
    )
    .optional(),
  variableName: variableNameSchema,
});

export const definition: NodeDefinition = {
  type: "DATA_TABLE",
  version: 1,
  category: "DATA",
  label: "Workspace Table",
  description: "Read or write to a native AutoFlow workspace table.",
  icon: "Database",
  keywords: [
    "database",
    "table",
    "store",
    "save",
    "record",
    "native",
    "internal",
  ],
  configSchema,
  defaults: { action: "insert", tableId: "", data: [], variableName: "record" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/DATA_TABLE",
};
