import { z } from "zod";

/**
 * The hosted intake form's field model (AF-M10-14). Isomorphic: the node
 * definition validates against it, the public page renders from it, and the
 * submission route validates against it.
 *
 * One definition, three consumers — because a form whose renderer and
 * validator disagree accepts input it then rejects, or worse, accepts input it
 * should not.
 */

export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "number",
  "select",
  "checkbox",
  "file",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const formFieldSchema = z.object({
  /**
   * Key the value lands under in the run context (`form.fields.<name>`).
   * Identifier-shaped so a template can address it without bracket syntax.
   */
  name: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]*$/,
      "Field names must start with a letter or underscore",
    )
    .max(64),
  label: z.string().min(1).max(200),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  /** Shown under the field. */
  help: z.string().max(500).optional(),
  /** Options for `select`, one per line in the editor. */
  options: z.string().max(4000).optional(),
  /** Character cap for text-ish fields. */
  maxLength: z.number().int().min(1).max(50_000).optional(),
});

export type FormField = z.infer<typeof formFieldSchema>;

/** Fields per form. More than this is a survey, not an intake form. */
export const MAX_FORM_FIELDS = 30;

/** Files one submission may carry. */
export const MAX_FORM_FILES = 5;

/**
 * Per-file cap for a public, unauthenticated endpoint.
 *
 * Deliberately far below the platform's 100 MB `MAX_FILE_BYTES`: this form is
 * reachable by anyone who has the link, so the ceiling here is about what a
 * stranger may push into our storage, not about what the platform can hold.
 */
export const MAX_FORM_FILE_BYTES = 10 * 1024 * 1024;

/** Whole-submission cap, including files. */
export const MAX_FORM_SUBMISSION_BYTES = 25 * 1024 * 1024;

/**
 * MIME types a form file field accepts.
 *
 * An allowlist, not a blocklist. The files this library's automations receive
 * are documents and images; accepting anything else on a public endpoint means
 * hosting arbitrary content for strangers under our domain.
 */
export const ALLOWED_FORM_FILE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

/** `options` is authored one per line; blank lines are ignored. */
export function parseOptions(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 200);
}

/** Parse a node's `fields` config, tolerating the JSON-string form. */
export function parseFormFields(raw: unknown): FormField[] {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return [];
          }
        })()
      : raw;

  const parsed = z.array(formFieldSchema).max(MAX_FORM_FIELDS).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export interface FieldValidationError {
  field: string;
  message: string;
}

/**
 * Validate one submitted value against its field.
 *
 * Returns a message rather than throwing, so a submission reports every
 * problem at once — a form that surfaces errors one at a time is how people
 * give up on a form.
 */
export function validateFieldValue(
  field: FormField,
  value: string | null,
): FieldValidationError | null {
  const present = value !== null && value.trim().length > 0;

  if (field.required && !present) {
    return { field: field.name, message: `${field.label} is required.` };
  }
  if (!present) {
    return null;
  }

  const text = value as string;

  if (field.maxLength && text.length > field.maxLength) {
    return {
      field: field.name,
      message: `${field.label} must be ${field.maxLength} characters or fewer.`,
    };
  }

  switch (field.type) {
    case "email":
      // Deliberately permissive: the RFC allows more than people expect, and
      // an intake form that rejects a valid address loses the lead.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        return {
          field: field.name,
          message: `${field.label} must be an email address.`,
        };
      }
      return null;
    case "number":
      if (!Number.isFinite(Number(text))) {
        return {
          field: field.name,
          message: `${field.label} must be a number.`,
        };
      }
      return null;
    case "select": {
      const options = parseOptions(field.options);
      if (options.length > 0 && !options.includes(text)) {
        // A value outside the option set means the request did not come from
        // the rendered form.
        return {
          field: field.name,
          message: `${field.label} must be one of the offered options.`,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Coerce a validated value to the type the run context should carry. */
export function coerceFieldValue(
  field: FormField,
  value: string | null,
): string | number | boolean | null {
  if (value === null) {
    return field.type === "checkbox" ? false : null;
  }
  switch (field.type) {
    case "number":
      return value.trim() === "" ? null : Number(value);
    case "checkbox":
      return value === "on" || value === "true";
    default:
      return value;
  }
}
