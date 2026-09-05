import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText, variableNameSchema } from "../../shared/config-fields";

export const configSchema = z.object({
  /** Result key in the run context: {{variableName.text}} */
  variableName: variableNameSchema.optional(),
  /**
   * Template resolving to a `FileRef` — usually `{{download.file}}` — or to a
   * bare file id. Both forms are accepted because a `CODE` node that carries
   * an id forward is a reasonable thing to write.
   */
  file: freeText(2048).optional(),
  /**
   * Characters to keep. Beyond this the text is cut and `truncated` is true —
   * never silently, because a contract analysed from its first half produces
   * a confident, wrong answer.
   */
  maxCharacters: z.number().int().min(1000).max(1_000_000).optional(),
});

export const definition: NodeDefinition = {
  type: "EXTRACT_DOCUMENT_TEXT",
  version: 1,
  category: "DATA",
  label: "Extract Document Text",
  description:
    "Read the text out of a PDF, DOCX, HTML or plain-text file and pass it downstream.",
  icon: "FileText",
  keywords: ["pdf", "docx", "extract", "text", "ocr", "document", "parse"],
  configSchema,
  defaults: {},
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/EXTRACT_DOCUMENT_TEXT",
};
