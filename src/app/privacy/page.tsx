import type { Metadata } from "next";

import { legalEntity, SUBPROCESSORS } from "@/config/legal";
import {
  LegalPage,
  LegalSection,
} from "@/features/legal/components/legal-page";
import { PLAN_RETENTION } from "@/lib/retention";

/**
 * Privacy Policy — DRAFT (AF-M8-10).
 *
 * NOT LEGAL ADVICE AND NOT REVIEWED BY A LAWYER. Written to describe what the
 * software actually does, so a qualified lawyer reviews facts rather than
 * boilerplate. Publication is gated on that review.
 *
 * The retention table is rendered from `PLAN_RETENTION` rather than typed out,
 * so the policy cannot promise a window the pruner does not honour. A privacy
 * policy that disagrees with the code is the specific failure worth
 * engineering against here.
 */

export const metadata: Metadata = {
  title: "AutoFlow — Privacy Policy",
  description:
    "What personal data AutoFlow collects, why, how long it is kept, and who it is shared with.",
};

const PLAN_ORDER = ["FREE", "STARTER", "PRO", "ENTERPRISE"] as const;

const describeDays = (days: number) =>
  Number.isFinite(days) ? `${days} days` : "retained until you delete it";

export default function PrivacyPage() {
  const entity = legalEntity();

  return (
    <LegalPage
      summary="What we collect, why we have it, how long we keep it, and who else sees it."
      title="Privacy Policy"
    >
      <LegalSection title="Who we are">
        <p>
          {entity?.name} is the controller of the personal data described in
          "Data we hold about you". For the data inside your workflows we are a
          processor acting on your instructions — see the{" "}
          <a className="underline" href="/dpa">
            Data Processing Addendum
          </a>
          .
        </p>
        <p>
          Contact us about privacy at{" "}
          <a className="underline" href={`mailto:${entity?.privacyEmail}`}>
            {entity?.privacyEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Data we hold about you">
        <p>
          <strong>Account data.</strong> Your name, email address, and
          authentication details. If you sign in with GitHub or Google we
          receive your profile and email from them. Passwords are stored hashed;
          we never see the original.
        </p>
        <p>
          <strong>Workspace data.</strong> Your organisation, its members, their
          roles, and an audit log of who changed what.
        </p>
        <p>
          <strong>Billing data.</strong> Subscription state and billing contact
          details, held by our payment provider. Card numbers never reach our
          systems.
        </p>
        <p>
          <strong>Operational data.</strong> Error reports and server logs. Both
          pass through redaction that removes credentials, tokens, cookies, and
          authorisation headers before they are stored or sent anywhere.
        </p>
      </LegalSection>

      <LegalSection title="Data inside your workflows">
        <p>
          Whatever your workflows process passes through and is recorded on the
          run so you can debug it. We do not inspect it, mine it, sell it, or
          use it to train any model. It is yours; we hold it to run the service
          for you.
        </p>
        <p>
          <strong>Credentials you store are encrypted at rest</strong> with a
          per-record key, and no part of the product returns a stored credential
          in plain text — not to you, not to our staff. Only the workflow runner
          decrypts one, at the moment it is needed, and the decrypted value is
          never written to the run record or to a log.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Execution history is deleted on a schedule set by your plan, in two
          stages. First the <strong>inputs and outputs</strong> recorded for
          each run are erased — that is the content your workflow handled, and
          it goes first because it is the sensitive part. The run record itself,
          which holds only timings, status, and cost, is deleted later.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline">
                <th className="py-2 pr-4 font-medium">Plan</th>
                <th className="py-2 pr-4 font-medium">Inputs and outputs</th>
                <th className="py-2 font-medium">Run record</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ORDER.map((plan) => (
                <tr className="border-b border-hairline" key={plan}>
                  <td className="py-2 pr-4">{plan}</td>
                  <td className="py-2 pr-4">
                    {describeDays(PLAN_RETENTION[plan].ioRetentionDays)}
                  </td>
                  <td className="py-2">
                    {describeDays(PLAN_RETENTION[plan].deleteAfterDays)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>
          Account and workspace data is kept while your account is open and
          deleted within 30 days of closure, except where a legal obligation
          requires us to keep something longer.
        </p>
      </LegalSection>

      <LegalSection title="Who else processes it">
        <p>
          We use the third parties below to run the service. They act on our
          instructions and may not use your data for their own purposes.
        </p>
        <ul className="flex flex-col gap-3">
          {SUBPROCESSORS.map((entry) => (
            <li key={entry.name}>
              <p className="text-foreground">
                {entry.name}
                {entry.optional ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    only if enabled
                  </span>
                ) : null}
              </p>
              <p>{entry.purpose}</p>
              <p className="text-xs">{entry.dataHandled}</p>
            </li>
          ))}
        </ul>
        <p>
          AI providers are used only for workflows you build with an AI node. If
          you never add one, no data reaches them.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Depending on where you live you may have the right to access, correct,
          export, or delete your personal data, to object to or restrict its
          processing, and to complain to a data protection authority. Write to{" "}
          <a className="underline" href={`mailto:${entity?.privacyEmail}`}>
            {entity?.privacyEmail}
          </a>{" "}
          and we will respond within the time the law allows.
        </p>
        <p>
          You can export your workflows and recent execution history through the
          application and its API at any time, without asking us.
        </p>
      </LegalSection>

      <LegalSection title="Security, and being honest about it">
        <p>
          Credentials are encrypted with per-record keys; access is scoped to
          your workspace and enforced in the database query rather than filtered
          afterwards; outbound requests from workflow nodes are blocked from
          reaching internal network addresses, including across redirects; and
          authentication, API, and webhook endpoints are rate limited.
        </p>
        <p>
          No system is perfectly secure. If we discover a breach affecting your
          personal data we will notify you and the relevant authority as
          required by law.
        </p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          We set cookies necessary to keep you signed in and to keep the
          application secure. We do not use advertising cookies or third-party
          tracking.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we change this policy materially we will tell you in the
          application before the change takes effect.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
