/**
 * Legal entity and policy configuration (AF-M8-10).
 *
 * The Terms, Privacy Policy, and DPA are drafted, but they name a company, a
 * jurisdiction, and a contact address that only the operator can supply. Those
 * values live here, sourced from environment variables, for one reason:
 *
 * **Unconfigured legal pages must not look published.** A privacy policy that
 * renders `[COMPANY_LEGAL_NAME]` in production is worse than no page at all -
 * it reads as a real policy to a user and as negligence to a regulator. So
 * `legalEntity()` returns `null` when the values are absent, and every legal
 * page renders a conspicuous draft notice instead of the policy text.
 *
 * Filling these in is a checklist item, not a code change:
 * `docs/operations/beta_launch_checklist.md`.
 */

export interface LegalEntity {
  /** Registered company name, e.g. "AutoFlow Technologies Ltd". */
  name: string;
  /** Governing law and venue, e.g. "England and Wales". */
  jurisdiction: string;
  /** Registered address, one line. */
  address: string;
  /** General contact for legal notices. */
  contactEmail: string;
  /** Privacy/data-protection contact. May be the same address. */
  privacyEmail: string;
}

/** Effective date shown on the policies. ISO date, operator-supplied. */
export const legalEffectiveDate = (): string | null =>
  process.env.NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE || null;

/**
 * The configured entity, or `null` when any required value is missing.
 *
 * Deliberately all-or-nothing. A policy that names the company in one clause
 * and a placeholder in the next is not a partially-configured policy, it is a
 * broken one.
 */
export const legalEntity = (): LegalEntity | null => {
  const entity: LegalEntity = {
    name: process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME ?? "",
    jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION ?? "",
    address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS ?? "",
    contactEmail: process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL ?? "",
    privacyEmail:
      process.env.NEXT_PUBLIC_LEGAL_PRIVACY_EMAIL ||
      process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL ||
      "",
  };

  const complete = Object.values(entity).every(
    (value) => value.trim().length > 0,
  );

  return complete ? entity : null;
};

/** Support contact shown on the support page and in the policies. */
export const supportEmail = (): string | null =>
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || null;

/**
 * Third parties that process customer data on our behalf.
 *
 * Listed here rather than written into the policy prose so the DPA's
 * subprocessor schedule and the Privacy Policy cannot drift apart, and so
 * adding one is a visible code change rather than an edit buried in a
 * paragraph. Every entry below is a service this application actually calls -
 * verified against the code, not aspirational.
 */
export interface Subprocessor {
  name: string;
  purpose: string;
  /** What customer data it can see. Plain language, not a category code. */
  dataHandled: string;
  /** True when the operator can run without it. */
  optional: boolean;
}

export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "Database and application hosting",
    purpose: "Runs the application and stores all customer data at rest.",
    dataHandled:
      "Everything: accounts, workflows, execution history and its inputs and outputs, and encrypted credentials.",
    optional: false,
  },
  {
    name: "Inngest",
    purpose: "Durable execution of workflow runs.",
    dataHandled:
      "Workflow and execution identifiers, and the step payloads passed between nodes during a run.",
    optional: false,
  },
  {
    name: "Sentry",
    purpose: "Error monitoring.",
    dataHandled:
      "Stack traces and scrubbed context. Request headers, cookies, and secret-shaped values are stripped before an event is sent, and AI prompts and completions are not recorded.",
    optional: true,
  },
  {
    name: "Resend",
    purpose: "Transactional email (password reset, address verification).",
    dataHandled: "Recipient email address and the generated link.",
    optional: true,
  },
  {
    name: "Polar",
    purpose: "Subscription billing and payment processing.",
    dataHandled:
      "Billing contact details and subscription state. Card details are handled by the payment processor and never reach this application.",
    optional: true,
  },
  {
    name: "AI model providers (OpenAI, Anthropic, Google)",
    purpose:
      "Executing AI nodes. Only invoked for workflows the customer configures with an AI node.",
    dataHandled:
      "The prompt content that workflow sends, which may include data drawn from earlier nodes in the run.",
    optional: true,
  },
];
