import type { Metadata } from "next";

import { legalEntity } from "@/config/legal";
import {
  LegalPage,
  LegalSection,
} from "@/features/legal/components/legal-page";

/**
 * Terms of Service — DRAFT (AF-M8-10).
 *
 * NOT LEGAL ADVICE AND NOT REVIEWED BY A LAWYER. This is an engineer's draft,
 * written to describe accurately what the software actually does so that a
 * qualified lawyer has something factual to work from rather than a blank
 * page. Publication is gated on that review — see
 * `docs/operations/beta_launch_checklist.md`.
 *
 * The page refuses to render until the legal entity is configured, so this
 * cannot be published by accident.
 */

export const metadata: Metadata = {
  title: "AutoFlow — Terms of Service",
  description: "The terms governing use of the AutoFlow service.",
};

export default function TermsPage() {
  const entity = legalEntity();

  return (
    <LegalPage
      summary="The agreement between you and us for use of the service."
      title="Terms of Service"
    >
      <LegalSection title="1. The agreement">
        <p>
          These terms are between you (or the organisation you act for, "you")
          and {entity?.name} ("we", "us"). By creating an account or using the
          service you accept them. If you are accepting on behalf of an
          organisation, you confirm you are authorised to bind it.
        </p>
      </LegalSection>

      <LegalSection title="2. The service">
        <p>
          AutoFlow lets you build and run automated workflows. You configure a
          workflow, connect it to third-party systems using credentials you
          supply, and we execute it on your behalf, keeping a record of each
          run.
        </p>
        <p>
          The service is offered during a <strong>beta period</strong>. It may
          change, break, or be interrupted, and features may be withdrawn.
          Availability targets are published at{" "}
          <a className="underline" href="/status">
            /status
          </a>{" "}
          and are not a contractual commitment during beta.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account and your workspace">
        <p>
          You are responsible for the security of your account and for the acts
          of everyone you invite into your workspace. Members hold roles that
          determine what they can do; granting someone a role is your decision
          and its consequences are yours.
        </p>
        <p>
          Note that some workspace state is shared rather than per-user — for
          example, whether an in-app notification has been read. Anyone in the
          workspace can see workspace data appropriate to their role.
        </p>
      </LegalSection>

      <LegalSection title="4. Your content and your credentials">
        <p>
          You keep all rights in the workflows you build, the data that passes
          through them, and the credentials you store. We claim no ownership.
          You grant us only the permission needed to operate the service for
          you: to store your content, execute your workflows, and transmit data
          to the third-party systems you have configured.
        </p>
        <p>
          Credentials are encrypted at rest and there is no interface — for you,
          for our staff, or for anyone else — that returns a stored credential
          in plain text. That is a property of the system, not a policy
          commitment we could change without changing the software.
        </p>
        <p>
          You are responsible for having the right to use the data you put into
          the service and to send it to the destinations you configure.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You must not use the service to:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>break the law, or help anyone else to;</li>
          <li>
            send unsolicited bulk messages, or scrape or attack systems you do
            not have permission to access;
          </li>
          <li>
            circumvent quotas, rate limits, or plan restrictions, including by
            creating multiple accounts to do so;
          </li>
          <li>
            store or transmit malware, or use a workflow to gain unauthorised
            access to any system;
          </li>
          <li>
            resell the service, or use it to build a substantially similar
            competing product.
          </li>
        </ul>
        <p>
          We may suspend a workspace that is causing harm to the service or to
          others. Where we can do so safely we will tell you first.
        </p>
      </LegalSection>

      <LegalSection title="6. Plans, quotas, and payment">
        <p>
          Each workspace is on a plan. The plan determines your monthly run
          allowance, your request rate limits, and how long your execution
          history is kept. Runs that exceed the allowance fail with a quota
          error rather than being silently dropped or billed as overage.
        </p>
        <p>
          Paid plans are billed in advance through our payment provider. Fees
          are non-refundable except where the law requires otherwise. We may
          change prices with notice, effective at your next renewal.
        </p>
        <p>
          Third-party costs your workflows incur — AI model usage, for example —
          are separate. We report estimated spend to you, but the relationship
          with that provider is yours.
        </p>
      </LegalSection>

      <LegalSection title="7. Retention and deletion">
        <p>
          Execution history is retained according to your plan, and in two
          stages: the inputs and outputs recorded for each run are erased after
          a short window, and the run record itself is deleted after a longer
          one. This is described in the{" "}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>
          . Export anything you need to keep before it ages out.
        </p>
        <p>
          You may close your account at any time. On closure we delete your
          workspace data within 30 days, except where we must retain something
          to meet a legal obligation.
        </p>
      </LegalSection>

      <LegalSection title="8. Warranties and liability">
        <p>
          During beta the service is provided <strong>as is</strong>. We do not
          warrant that it will be uninterrupted, error-free, or that a workflow
          will run at a particular time. You are responsible for deciding
          whether it is suitable for a given purpose, and for not relying on it
          alone where failure would cause serious harm.
        </p>
        <p>
          To the fullest extent the law allows, we are not liable for indirect
          or consequential loss, for lost profits or revenue, or for loss
          arising from actions your workflows took in third-party systems. Our
          total liability in any 12-month period is limited to the amount you
          paid us in that period.
        </p>
        <p>Nothing here excludes liability that cannot lawfully be excluded.</p>
      </LegalSection>

      <LegalSection title="9. Termination">
        <p>
          You may stop using the service at any time. We may suspend or end your
          access if you materially breach these terms, or if we discontinue the
          service — in which case we will give reasonable notice and a chance to
          export your data.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes and governing law">
        <p>
          We may update these terms. Material changes will be notified in the
          application before they take effect, and continuing to use the service
          after that means you accept them.
        </p>
        <p>
          These terms are governed by the law of {entity?.jurisdiction}, and its
          courts have exclusive jurisdiction.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
