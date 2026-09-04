import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HostedForm } from "@/features/forms/components/hosted-form";
import { findPublishedForm } from "@/features/forms/server/form-lookup";

/**
 * The public intake form (AF-M10-14).
 *
 * Outside `(dashboard)`, so it is reachable without a session — that is the
 * point. `findPublishedForm` is the only gate, and it returns null for every
 * reason a visitor must not be able to tell apart.
 */

interface PageProps {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<{ s?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const [{ workflowId }, { s }] = await Promise.all([params, searchParams]);
  const form = await findPublishedForm({ workflowId, pathSegment: s });
  return {
    title: form ? form.title : "Form not found",
    // A public intake form should not be indexed: the URL is shared
    // deliberately with the people meant to fill it in.
    robots: { index: false, follow: false },
  };
}

export default async function FormPage({ params, searchParams }: PageProps) {
  const [{ workflowId }, { s }] = await Promise.all([params, searchParams]);

  const form = await findPublishedForm({ workflowId, pathSegment: s });
  if (!form) {
    // Not "unpublished" or "disabled" — one answer, so the page cannot be used
    // to enumerate workflows.
    notFound();
  }

  if (form.fields.length === 0) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center px-4 py-12">
      <HostedForm
        action={`/api/forms/${workflowId}${s ? `?s=${encodeURIComponent(s)}` : ""}`}
        title={form.title}
        description={form.description}
        submitLabel={form.submitLabel}
        successMessage={form.successMessage}
        fields={form.fields}
      />
    </main>
  );
}
