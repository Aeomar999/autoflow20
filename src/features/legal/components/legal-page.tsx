import Link from "next/link";
import type { ReactNode } from "react";

import { legalEffectiveDate, legalEntity } from "@/config/legal";

/**
 * Shell for the Terms, Privacy Policy, and DPA (AF-M8-10).
 *
 * Its job is the guard. When `legalEntity()` is unconfigured the policy body
 * is **not rendered at all** — the page shows what is missing instead. A
 * privacy policy displaying `[COMPANY_LEGAL_NAME]` reads as a real policy to a
 * user and as negligence to a regulator, and "we will remember to fill it in
 * before launch" is exactly the kind of promise that does not survive a launch
 * week. Making it structurally impossible is cheaper than remembering.
 */

export const LegalSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="text-lg font-medium">{title}</h2>
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
      {children}
    </div>
  </section>
);

const NotConfigured = ({ title }: { title: string }) => (
  <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>

    <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 text-sm">
      <p className="font-medium">This document is not published yet.</p>
      <p className="mt-2 text-muted-foreground">
        A draft exists, but it names a company, a jurisdiction, and a contact
        address that have not been configured for this deployment. Rather than
        show a policy with blanks in it — which would read as a real policy —
        the page withholds it.
      </p>
    </div>

    <div className="text-sm text-muted-foreground">
      <p>To publish it, set these and redeploy:</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        <li>
          <code>NEXT_PUBLIC_LEGAL_ENTITY_NAME</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_LEGAL_JURISDICTION</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_LEGAL_ADDRESS</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_LEGAL_CONTACT_EMAIL</code>
        </li>
        <li>
          <code>NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE</code>
        </li>
      </ul>
      <p className="mt-3">
        The drafts must be reviewed by a qualified lawyer before publication.
        See <code>docs/operations/beta_launch_checklist.md</code>.
      </p>
    </div>

    <Link className="text-sm hover:underline" href="/">
      ← Back to AutoFlow
    </Link>
  </main>
);

export const LegalPage = ({
  title,
  summary,
  children,
}: {
  title: string;
  /** One line describing what this document covers, shown under the title. */
  summary: string;
  children: ReactNode;
}) => {
  const entity = legalEntity();
  const effectiveDate = legalEffectiveDate();

  if (!entity || !effectiveDate) {
    return <NotConfigured title={title} />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href="/"
        >
          ← AutoFlow
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{summary}</p>
        <p className="text-sm text-muted-foreground">
          {entity.name} · Effective{" "}
          <time dateTime={effectiveDate}>{effectiveDate}</time>
        </p>
      </header>

      {children}

      <footer className="flex flex-col gap-2 border-t border-hairline pt-6 text-sm text-muted-foreground">
        <p>
          {entity.name}, {entity.address}.
        </p>
        <p>
          Questions about this document:{" "}
          <a className="underline" href={`mailto:${entity.contactEmail}`}>
            {entity.contactEmail}
          </a>
          .
        </p>
        <p className="flex gap-4">
          <Link className="hover:underline" href="/terms">
            Terms
          </Link>
          <Link className="hover:underline" href="/privacy">
            Privacy
          </Link>
          <Link className="hover:underline" href="/dpa">
            DPA
          </Link>
        </p>
      </footer>
    </main>
  );
};
