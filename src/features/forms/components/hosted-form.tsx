"use client";

import { useState } from "react";
import { type FormField, parseOptions } from "../form-schema";

/**
 * The public intake form (AF-M10-14).
 *
 * A plain `<form>` submitted with `fetch`, not a form library: this page is
 * served to strangers, so every kilobyte and every dependency is one they pay
 * for. It also has to keep working when JavaScript fails, which is why the
 * markup is a real form with real field names — the fetch is an enhancement
 * over a submission the browser could make on its own.
 */

interface HostedFormProps {
  action: string;
  title: string;
  description?: string;
  submitLabel: string;
  successMessage: string;
  fields: FormField[];
}

type FieldError = { field: string; message: string };

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring/30";

export function HostedForm({
  action,
  title,
  description,
  submitLabel,
  successMessage,
  fields,
}: HostedFormProps) {
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const errorFor = (name: string) =>
    errors.find((error) => error.field === name)?.message;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setErrors([]);
    setFailure(null);

    try {
      const response = await fetch(action, {
        method: "POST",
        body: new FormData(event.currentTarget),
      });

      if (response.ok) {
        setState("done");
        return;
      }

      const body = (await response.json().catch(() => ({}))) as {
        errors?: FieldError[];
        error?: string;
      };

      if (body.errors?.length) {
        setErrors(body.errors);
      } else {
        // Says what happened rather than "something went wrong": a submitter
        // who hit a rate limit can wait, and one who hit a 500 should not.
        setFailure(
          response.status === 429
            ? "Too many submissions right now. Please try again in a minute."
            : response.status === 413
              ? "That submission is too large. Try smaller attachments."
              : "Something went wrong sending this. Please try again.",
        );
      }
      setState("idle");
    } catch {
      setFailure("Could not reach the server. Check your connection.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <output className="block rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{successMessage}</p>
      </output>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      action={action}
      method="post"
      encType="multipart/form-data"
      className="flex flex-col gap-6 rounded-lg border border-border bg-card p-6 sm:p-8"
      noValidate
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {description}
          </p>
        ) : null}
      </header>

      {failure ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {failure}
        </p>
      ) : null}

      {fields.map((field) => {
        const id = `field-${field.name}`;
        const message = errorFor(field.name);
        const describedBy = [
          field.help ? `${id}-help` : null,
          message ? `${id}-error` : null,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {field.label}
              {field.required ? (
                <span className="ml-1 text-destructive" aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>

            <FieldInput field={field} id={id} describedBy={describedBy} />

            {field.help ? (
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {field.help}
              </p>
            ) : null}
            {message ? (
              <p id={`${id}-error`} className="text-xs text-destructive">
                {message}
              </p>
            ) : null}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={state === "submitting"}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {state === "submitting" ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}

function FieldInput({
  field,
  id,
  describedBy,
}: {
  field: FormField;
  id: string;
  describedBy: string;
}) {
  // `required` is deliberately NOT set on the element: the server validates
  // every field and reports all problems at once, and native validation would
  // stop the submit at the first one with a different message.
  const shared = {
    id,
    name: field.name,
    className: inputClass,
    placeholder: field.placeholder,
    "aria-describedby": describedBy || undefined,
    "aria-required": field.required || undefined,
  };

  switch (field.type) {
    case "textarea":
      return <textarea {...shared} rows={5} maxLength={field.maxLength} />;
    case "select": {
      const options = parseOptions(field.options);
      return (
        <select {...shared} defaultValue="">
          <option value="">Choose…</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }
    case "checkbox":
      return (
        <input
          id={id}
          name={field.name}
          type="checkbox"
          className="size-4 rounded border-border"
          aria-describedby={describedBy || undefined}
        />
      );
    case "file":
      return <input {...shared} type="file" />;
    case "number":
      return <input {...shared} type="number" />;
    case "email":
      return <input {...shared} type="email" maxLength={field.maxLength} />;
    default:
      return <input {...shared} type="text" maxLength={field.maxLength} />;
  }
}
