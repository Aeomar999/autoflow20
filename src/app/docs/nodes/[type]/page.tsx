import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  findNodeReference,
  nodeReference,
} from "@/features/docs/lib/node-reference";
import type { ResolvedConfigField } from "@/features/editor/lib/config-schema";

/** One page per registered type, known at build time from the registry. */
export const generateStaticParams = async () =>
  nodeReference().map((entry) => ({ type: entry.type }));

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> => {
  const entry = findNodeReference(decodeURIComponent((await params).type));
  if (!entry) {
    return { title: "AutoFlow — node reference" };
  }
  return {
    title: `${entry.label} — AutoFlow node reference`,
    description: entry.description,
  };
};

const KIND_LABELS: Record<ResolvedConfigField["kind"], string> = {
  string: "text",
  multiline: "long text",
  number: "number",
  boolean: "true / false",
  enum: "one of",
  "kv-list": "key–value pairs",
  keyValueList: "key–value pairs",
  fieldList: "list of rows",
  credential: "credential",
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-lg font-medium">{title}</h2>
    {children}
  </section>
);

const FieldRow = ({ field }: { field: ResolvedConfigField }) => (
  <li className="flex flex-col gap-1 border-t border-hairline py-3 first:border-t-0">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <code className="text-sm font-medium">{field.key}</code>
      <span className="text-xs text-muted-foreground">
        {KIND_LABELS[field.kind]}
      </span>
      {field.optional ? (
        <span className="text-xs text-muted-foreground">optional</span>
      ) : (
        <span className="text-xs text-danger">required</span>
      )}
    </div>

    {field.description ? (
      <p className="text-sm text-muted-foreground">{field.description}</p>
    ) : null}

    {field.enumValues?.length ? (
      <p className="text-xs text-muted-foreground">
        One of: {field.enumValues.map((value) => value).join(", ")}
      </p>
    ) : null}

    {field.columns?.length ? (
      <p className="text-xs text-muted-foreground">
        Columns: {field.columns.map((column) => column.key).join(", ")}
      </p>
    ) : null}

    {field.credential ? (
      <p className="text-xs text-muted-foreground">
        Credential type <code>{field.credential.type}</code>. Stored encrypted;
        the value is never returned to the browser or written to a trace.
      </p>
    ) : null}
  </li>
);

export default async function NodeDetailPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const entry = findNodeReference(decodeURIComponent((await params).type));

  if (!entry) {
    notFound();
  }

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href="/docs/nodes"
        >
          ← Node reference
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {entry.label}
          </h1>
          <code className="rounded bg-well px-2 py-0.5 text-xs text-muted-foreground">
            {entry.type}
          </code>
        </div>

        <p className="max-w-2xl text-muted-foreground">{entry.description}</p>
      </header>

      {entry.deprecated ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-medium">
            Deprecated since {entry.deprecated.since} — use{" "}
            <Link
              className="underline"
              href={`/docs/nodes/${encodeURIComponent(entry.deprecated.replacedBy)}`}
            >
              {entry.deprecated.replacedBy}
            </Link>{" "}
            instead.
          </p>
          <p className="mt-1 text-muted-foreground">
            {entry.deprecated.reason} Existing workflows using this node keep
            working; it is only unavailable for new ones.
          </p>
        </div>
      ) : null}

      <Section title="Configuration">
        {entry.fields === null ? (
          <p className="text-sm text-muted-foreground">
            This node's configuration schema uses a shape the reference cannot
            describe automatically. Open the node in the editor to see its
            fields.
          </p>
        ) : entry.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This node takes no configuration.
          </p>
        ) : (
          <ul className="rounded-xl border border-hairline bg-panel px-4">
            {entry.fields.map((field) => (
              <FieldRow field={field} key={field.key} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ports">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium">Inputs</h3>
            {entry.isTrigger ? (
              <p className="mt-1 text-sm text-muted-foreground">
                None — this node starts a workflow.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
                {entry.inputs.map((port) => (
                  <li key={port.id}>
                    <code className="text-foreground">{port.id}</code>{" "}
                    {port.label}
                    {port.required ? " (required)" : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium">Outputs</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm text-muted-foreground">
              {entry.outputs.map((port) => (
                <li key={port.id}>
                  <code className="text-foreground">{port.id}</code>{" "}
                  {port.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Execution">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Type version</dt>
          <dd>{entry.version}</dd>

          <dt className="text-muted-foreground">Retry</dt>
          <dd>
            {entry.defaultRetry && entry.defaultRetry.maxAttempts > 1
              ? `up to ${entry.defaultRetry.maxAttempts} attempts, ${entry.defaultRetry.backoffMs}ms exponential backoff`
              : "no retry by default"}
          </dd>

          <dt className="text-muted-foreground">Timeout</dt>
          <dd>
            {entry.timeoutMs
              ? `${entry.timeoutMs / 1000}s per attempt`
              : "engine default"}
          </dd>

          {entry.supportsResponseCache ? (
            <>
              <dt className="text-muted-foreground">Response cache</dt>
              <dd>
                Supported — set <code>cacheTtlSeconds</code> to reuse an
                identical call within the window. A cached run records zero
                tokens and zero cost, because nothing was purchased.
              </dd>
            </>
          ) : null}

          {entry.credentials.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Credentials</dt>
              <dd>
                {entry.credentials
                  .map(
                    (credential) =>
                      `${credential.type}${credential.required ? "" : " (optional)"}`,
                  )
                  .join(", ")}
              </dd>
            </>
          ) : null}
        </dl>
      </Section>
    </article>
  );
}
