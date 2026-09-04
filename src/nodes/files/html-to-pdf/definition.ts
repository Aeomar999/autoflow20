import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const PAGE_SIZES = ["A4", "LETTER", "LEGAL", "A3", "A5"] as const;
export const PAGE_ORIENTATIONS = ["portrait", "landscape"] as const;

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.file}} */
  variableName: variableNameSchema.optional(),
  /** Templated HTML. Scripts never run and remote resources are never fetched. */
  html: freeText(2_000_000).optional(),
  /** Name the produced file carries downstream. */
  filename: freeText(255).optional(),
  pageSize: z.enum(PAGE_SIZES).optional(),
  orientation: z.enum(PAGE_ORIENTATIONS).optional(),
  /** Page margins in points, clockwise from the left. */
  marginTop: z.number().int().min(0).max(200).optional(),
  marginRight: z.number().int().min(0).max(200).optional(),
  marginBottom: z.number().int().min(0).max(200).optional(),
  marginLeft: z.number().int().min(0).max(200).optional(),
  /** Repeated at the top of every page. */
  header: freeText(500).optional(),
  /** Repeated at the foot of every page; the page number is always appended. */
  footer: freeText(500).optional(),
  font: z.enum(["Helvetica", "Times", "Courier"]).optional(),
});

export const definition: NodeDefinition = {
  type: "HTML_TO_PDF",
  version: 1,
  category: "DATA",
  label: "HTML to PDF",
  description:
    "Render templated HTML into a PDF and pass a file reference downstream. Scripts never run and remote resources are never fetched.",
  icon: "FileType2",
  keywords: ["pdf", "html", "render", "report", "document", "print"],
  configSchema,
  defaults: { pageSize: "A4", orientation: "portrait" },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/HTML_TO_PDF",
};
