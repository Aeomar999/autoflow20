import type { Metadata } from "next";
import Link from "next/link";

import { legalEntity, supportEmail } from "@/config/legal";

/**
 * In-app route to support (AF-M8-10, checklist item 5.3).
 *
 * `docs/operations/support.md` describes how support is run; this is the only
 * thing a *user* sees. Before it existed the address had to be found on the
 * marketing site, which the checklist recorded as "no in-app support entry
 * point".
 *
 * Deliberately honest about what support is and is not. There is no ticketing
 * system, no SLA, and no out-of-hours cover (`support.md` §7), so this page
 * says so rather than implying a response time nobody has committed to. A
 * promise made here is a promise the operator has to keep at 3am.
 *
 * Like the legal pages, it renders what is missing rather than a broken
 * `mailto:` when `NEXT_PUBLIC_SUPPORT_EMAIL` is unset.
 */

export const metadata: Metadata = {
  title: "AutoFlow — Support",
  description: "How to get help with AutoFlow.",
};

export default function SupportPage() {
  const email = supportEmail();
  const entity = legalEntity();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link
          className="text-sm text-muted-foreground hover:text-foreground"
          href="/"
        >
          ← AutoFlow
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
        <p className="text-muted-foreground">
          How to get help, and what to expect when you ask.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Contact us</h2>
        {email ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Email{" "}
            <a className="underline" href={`mailto:${email}`}>
              {email}
            </a>
            . Include your workspace name and, if a run failed, the execution
            link — it carries the per-node trace we need to answer you.
          </p>
        ) : (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 text-sm">
            <p className="font-medium">
              No support address is configured for this deployment.
            </p>
            <p className="mt-2 text-muted-foreground">
              Set <code>NEXT_PUBLIC_SUPPORT_EMAIL</code> and redeploy. Showing a
              broken <code>mailto:</code> would be worse than saying nothing.
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Before you write</h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>
            <Link className="underline" href="/status">
              /status
            </Link>{" "}
            reports whether the service itself is healthy right now.
          </li>
          <li>
            <Link className="underline" href="/docs">
              The documentation
            </Link>{" "}
            covers every node and the expression syntax.
          </li>
          <li>
            A failed run's execution page names the node that failed and the
            error it raised, which is usually the whole answer.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">What we do not offer yet</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          AutoFlow is in beta. There is no ticketing system, no guaranteed
          response time, and no out-of-hours cover. Support is email, answered
          during working hours, and nothing on this page is a service-level
          commitment. We would rather tell you that than let you assume
          otherwise while an automation is down.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Data and privacy requests</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Requests about your personal data — access, export, or deletion — go
          to the privacy contact in our{" "}
          <Link className="underline" href="/privacy">
            Privacy Policy
          </Link>
          {entity ? (
            <>
              {" "}
              (
              <a className="underline" href={`mailto:${entity.privacyEmail}`}>
                {entity.privacyEmail}
              </a>
              )
            </>
          ) : null}
          , not to general support. Those requests run on a statutory clock and
          are handled separately.
        </p>
      </section>

      <footer className="flex gap-4 border-t border-hairline pt-6 text-sm text-muted-foreground">
        <Link className="hover:underline" href="/terms">
          Terms
        </Link>
        <Link className="hover:underline" href="/privacy">
          Privacy
        </Link>
        <Link className="hover:underline" href="/dpa">
          DPA
        </Link>
      </footer>
    </main>
  );
}
