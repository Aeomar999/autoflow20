import type { Metadata } from "next";

import { legalEntity, SUBPROCESSORS } from "@/config/legal";
import {
  LegalPage,
  LegalSection,
} from "@/features/legal/components/legal-page";

/**
 * Data Processing Addendum — DRAFT (AF-M8-10).
 *
 * NOT LEGAL ADVICE AND NOT REVIEWED BY A LAWYER. A DPA is the document most
 * likely to be read by someone else's lawyer during procurement, so this draft
 * exists to make that review cheap: it states accurately what the system does,
 * and leaves the clauses that need legal judgement — transfer mechanism,
 * liability, standard contractual clauses — explicitly flagged for counsel.
 */

export const metadata: Metadata = {
  title: "AutoFlow — Data Processing Addendum",
  description:
    "How AutoFlow processes customer personal data as a processor, including subprocessors and security measures.",
};

export default function DpaPage() {
  const entity = legalEntity();

  return (
    <LegalPage
      summary="How we process personal data on your behalf, as your processor."
      title="Data Processing Addendum"
    >
      <LegalSection title="1. Roles">
        <p>
          This addendum forms part of the{" "}
          <a className="underline" href="/terms">
            Terms of Service
          </a>
          . For personal data contained in the workflows you run,{" "}
          <strong>you are the controller</strong> and {entity?.name} is the{" "}
          <strong>processor</strong>. For the account data we hold about your
          users we are a controller in our own right, and the{" "}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>{" "}
          applies.
        </p>
      </LegalSection>

      <LegalSection title="2. Scope of processing">
        <p>
          <strong>Subject matter:</strong> operation of the AutoFlow workflow
          automation service.
        </p>
        <p>
          <strong>Duration:</strong> for as long as your account is open, plus
          the retention windows set out in the Privacy Policy.
        </p>
        <p>
          <strong>Nature and purpose:</strong> storing your workflow
          definitions, executing them, transmitting data to the third-party
          systems you configure, and recording each run so you can inspect it.
        </p>
        <p>
          <strong>Categories of data:</strong> determined by you. We do not
          control what your workflows carry. If you route special-category data
          through the service, you are responsible for having a lawful basis and
          for judging whether the service is appropriate for it.
        </p>
        <p>
          <strong>Data subjects:</strong> determined by you — typically your
          customers, staff, or contacts.
        </p>
      </LegalSection>

      <LegalSection title="3. Our obligations">
        <p>We will:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            process personal data only on your documented instructions, of which
            your configuration of the service is the primary form;
          </li>
          <li>
            ensure people authorised to process it are bound by confidentiality;
          </li>
          <li>
            implement the technical and organisational measures in section 5;
          </li>
          <li>
            assist you, so far as we reasonably can, with data subject requests,
            impact assessments, and breach notification;
          </li>
          <li>
            delete your data on termination as described in the Terms, subject
            to legal retention obligations;
          </li>
          <li>
            make available the information reasonably needed to demonstrate
            compliance with this addendum.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Subprocessors">
        <p>
          You authorise us to engage the subprocessors below. We remain
          responsible for their performance. We will give notice before adding
          one, and you may object on reasonable data protection grounds.
        </p>
        <ul className="flex flex-col gap-3">
          {SUBPROCESSORS.map((entry) => (
            <li key={entry.name}>
              <p className="text-foreground">
                {entry.name}
                {entry.optional ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    only where enabled
                  </span>
                ) : null}
              </p>
              <p>{entry.purpose}</p>
              <p className="text-xs">{entry.dataHandled}</p>
            </li>
          ))}
        </ul>
        <p>
          AI providers are engaged only for workflows you configure with an AI
          node. That is your instruction, given by building the workflow, and
          the prompt content sent is whatever that workflow assembles.
        </p>
      </LegalSection>

      <LegalSection title="5. Security measures">
        <p>These are properties of the system as built, not aspirations:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>Credential encryption.</strong> Stored credentials are
            encrypted at rest with a per-record key, which is itself encrypted
            with a master key held outside the database. No interface returns a
            stored credential in plain text.
          </li>
          <li>
            <strong>Tenant isolation.</strong> Every query is scoped to your
            organisation in the query itself, not filtered afterwards, and this
            is covered by an automated test suite.
          </li>
          <li>
            <strong>Access control.</strong> Role-based permissions within a
            workspace, with mutations recorded in an audit log.
          </li>
          <li>
            <strong>Egress control.</strong> Outbound requests made by workflow
            nodes cannot reach private, loopback, or cloud-metadata addresses,
            and this is re-checked on every redirect hop.
          </li>
          <li>
            <strong>Log and error redaction.</strong> Credentials, tokens,
            cookies, and authorisation headers are stripped before anything is
            logged or sent to our error monitoring.
          </li>
          <li>
            <strong>Retention limits.</strong> Run inputs and outputs are erased
            on the schedule in the Privacy Policy, so the sensitive content of a
            run does not persist indefinitely.
          </li>
          <li>
            <strong>Rate limiting</strong> on authentication, API, and webhook
            endpoints.
          </li>
          <li>
            <strong>Encryption in transit</strong> for all connections.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="6. International transfers">
        <p>
          Where personal data is transferred outside its country of origin, the
          transfer is made under an appropriate safeguard. The specific
          mechanism and the hosting regions applicable to your account are
          stated in your order documentation — ask us at{" "}
          <a className="underline" href={`mailto:${entity?.privacyEmail}`}>
            {entity?.privacyEmail}
          </a>{" "}
          if you need them confirmed for a procurement review.
        </p>
      </LegalSection>

      <LegalSection title="7. Breach notification">
        <p>
          We will notify you without undue delay after becoming aware of a
          personal data breach affecting your data, with the information you
          reasonably need in order to meet your own notification obligations.
        </p>
      </LegalSection>

      <LegalSection title="8. Audit">
        <p>
          On reasonable request, and no more than once a year unless a
          supervisory authority requires otherwise, we will provide the
          information necessary to demonstrate compliance with this addendum.
        </p>
      </LegalSection>

      <LegalSection title="9. Deletion and return">
        <p>
          On termination we delete your data in line with the Terms. Execution
          history may already have been deleted earlier under the retention
          schedule — export what you need while it is available.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
