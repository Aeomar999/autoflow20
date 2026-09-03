import { z } from "zod";
import { formFieldSchema, MAX_FORM_FIELDS } from "@/features/forms/form-schema";
import type { NodeDefinition } from "@/nodes/types";
import { freeText } from "../../shared/config-fields";

export const configSchema = z.object({
  /** Shown as the form's heading. */
  title: freeText(200).optional(),
  /** Shown under the heading. */
  description: freeText(2000).optional(),
  /** Submit button label. */
  submitLabel: freeText(60).optional(),
  /** Shown after a successful submission. */
  successMessage: freeText(2000).optional(),
  /** The fields, in display order. */
  fields: z.array(formFieldSchema).max(MAX_FORM_FIELDS).optional(),
  /**
   * Optional extra path segment. A form is public by design — anyone with the
   * link can submit — so this is obscurity, not authentication: it keeps a
   * form off a guessable URL, and the docs say exactly that rather than
   * implying it is a secret.
   */
  pathSecret: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]*$/,
      "The path segment may contain letters, numbers, hyphens and underscores",
    )
    .max(64)
    .optional(),
});

export const definition: NodeDefinition = {
  type: "FORM_TRIGGER",
  version: 1,
  category: "TRIGGER",
  label: "Form",
  description:
    "Start the workflow when someone submits a form hosted by AutoFlow. Fields are authored here; file fields become file references.",
  icon: "TextCursorInput",
  keywords: ["form", "intake", "submit", "request", "trigger", "public"],
  configSchema,
  defaults: {
    title: "Submit a request",
    submitLabel: "Submit",
    fields: [],
  },
  inputs: [],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/FORM_TRIGGER",
};
