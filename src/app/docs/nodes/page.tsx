import type { Metadata } from "next";
import Link from "next/link";
import { nodeReferenceByCategory } from "@/features/docs/lib/node-reference";

export const metadata: Metadata = {
  title: "AutoFlow — node reference",
  description:
    "Every AutoFlow node type, its configuration fields, ports, and credentials.",
};

export default function NodeIndexPage() {
  const groups = nodeReferenceByCategory();

  return (
    <article className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Node reference
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Generated from the node registry, so it describes the nodes this
          deployment actually has. Deprecated types are still listed — a saved
          workflow can contain one and still run it — and are marked as such.
        </p>
      </header>

      {groups.map((group) => (
        <section className="flex flex-col gap-4" key={group.category}>
          <h2 className="text-lg font-medium">{group.label}</h2>

          <ul className="grid gap-3 sm:grid-cols-2">
            {group.entries.map((entry) => (
              <li key={entry.type}>
                <Link
                  className="flex h-full flex-col gap-1.5 rounded-xl border border-hairline bg-panel p-4 transition-colors hover:border-primary/50"
                  href={`/docs/nodes/${encodeURIComponent(entry.type)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium">{entry.label}</span>
                    {entry.deprecated ? (
                      <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning">
                        Deprecated
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {entry.description}
                  </p>
                  <code className="mt-auto pt-1 text-xs text-muted-foreground">
                    {entry.type}
                  </code>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
