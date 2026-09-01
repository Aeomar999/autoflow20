import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Documentation shell (AF-M8-09).
 *
 * Public and outside the `(dashboard)` group: the node reference and the
 * expression language are what someone reads while deciding whether to sign
 * up, and gating them behind a session would be self-defeating.
 */

const SECTIONS: { href: string; label: string; blurb: string }[] = [
  { href: "/docs", label: "Overview", blurb: "Start here" },
  {
    href: "/docs/nodes",
    label: "Node reference",
    blurb: "Every node type and its configuration",
  },
  {
    href: "/docs/expressions",
    label: "Expressions",
    blurb: "Referencing data between nodes",
  },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:flex-row md:gap-12 md:py-16">
        <nav
          aria-label="Documentation"
          className="shrink-0 md:sticky md:top-16 md:h-fit md:w-56"
        >
          <Link
            className="text-sm font-semibold tracking-tight hover:underline"
            href="/"
          >
            AutoFlow
          </Link>
          <p className="mt-0.5 text-sm text-muted-foreground">Documentation</p>

          <ul className="mt-5 flex flex-col gap-1">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  className="block rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-well"
                  href={section.href}
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
