import type { Metadata } from "next";
import Link from "next/link";
import { nodeReference } from "@/features/docs/lib/node-reference";

export const metadata: Metadata = {
  title: "AutoFlow — documentation",
  description: "Node reference and expression language for AutoFlow workflows.",
};

export default function DocsIndexPage() {
  const nodes = nodeReference();
  const available = nodes.filter((entry) => !entry.deprecated).length;

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
        <p className="max-w-2xl text-muted-foreground">
          A workflow is a graph of nodes. Each node takes configuration, runs
          once per execution, and returns an output that later nodes can read
          through expressions. These two pages cover both halves of that.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          className="flex flex-col gap-2 rounded-xl border border-hairline bg-panel p-5 transition-colors hover:border-primary/50"
          href="/docs/nodes"
        >
          <h2 className="font-medium">Node reference</h2>
          <p className="text-sm text-muted-foreground">
            All {available} available node types — their configuration fields,
            ports, credentials, and retry behaviour.
          </p>
        </Link>

        <Link
          className="flex flex-col gap-2 rounded-xl border border-hairline bg-panel p-5 transition-colors hover:border-primary/50"
          href="/docs/expressions"
        >
          <h2 className="font-medium">Expressions</h2>
          <p className="text-sm text-muted-foreground">
            How a node reads the output of the nodes before it, and the escaping
            rule that catches everyone once.
          </p>
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">How this reference is built</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The node pages are generated from the node registry at request time —
          the same definitions the editor palette, the configuration panel, and
          graph validation read. A field documented here is a field the editor
          renders, because there is only one description of it. Nothing on those
          pages is written by hand, so nothing on them can go stale.
        </p>
      </section>
    </article>
  );
}
