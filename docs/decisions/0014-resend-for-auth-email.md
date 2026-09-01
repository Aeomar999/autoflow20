# 0014 - Resend for transactional auth email

**Status:** Accepted (AF-M8-04).

## Context

AF-M8-04 requires password reset and email verification flows to send email.
Two realities shaped the decision.

First, the constraint that normally pushes us to reuse the stack:
`docs/engineering/engineering_rules.md` says prefer existing libraries over
adding a dependency, and the repo already ships `nodemailer` (used by the
workflow `email.send` node and the SMTP credential tester). One option was to
reuse nodemailer with a user-supplied SMTP server for auth email.

Second, the operational reality of auth email specifically: verification and
reset emails are a security-critical, rarely-failed path where deliverability,
rates, and reliability matter more than sending node SMTP does. The workflow
node's SMTP is a *secondary* channel that occasionally fails and is acceptable
for that to bubble up as an execution error; silently failing a password reset
or a verification link is a different class of problem (account recovery and
proof-of-address ownership are the security anchor for the whole login flow).

Engineering_rules permits a justified new dependency ("Justify + ADR if you
must"). This is that justification.

## Decision

Ship transactional auth email through **Resend** via the official `resend` SDK,
as a new first-party dependency. A single server-only module,
`src/lib/email.ts`, owns all auth-email sending:

- Better Auth calls `sendPasswordResetEmail` / `sendVerificationEmail` (wired in
  `src/lib/auth.ts`); the module builds the Resend payload with curated HTML and
  text and inspects the SDK's returned `{ error }`.
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are **optional** at boot (the app
  still boots without them — same pattern as Polar billing) but the module
  throws `ResendNotConfiguredError` the moment a flow actually needs to send and
  the key is absent. Auth that needs email fails loudly; it never silently
  pretends an email went out.
- Never log the API key, the reset/verify token, or any password. Only the
  recipient address and the generated link leave the server.

## Consequences

- Auth email is a managed, delivered, rate-tolerant channel with a repeatable
  API — appropriate for the security-critical recovery/verification path.
- One new dependency (`resend`), which this ADR justifies against the reuse-the-
  stack rule. Workflow node SMTP (`nodemailer`) is intentionally unchanged; it
  is a different, lower-ceremony channel.
- The `resend` key must be provisioned in every environment that wants auth
  email; until then, email-delivering auth actions error loudly rather than
  fail silently. This is the traded-off operational knob (a hard "no email"
  instead of a best-effort fallback).
- We accept egress to `api.resend.com` at runtime. No new data-store
  dependency; Better Auth token storage reuses the existing `Verification`
  table, so there is no migration.

## Alternatives considered

- **Reuse `nodemailer` + user-supplied SMTP for auth email** — rejected: couples
  a security-critical path to a per-customer SMTP credential that the workflow
  node already treats as best-effort, and gives us no deliverability/rate
  guarantees. Keeping the two channels separate is the cleaner seam.
- **SendGrid/Mailgun/etc.** — equivalent providers; Resend was chosen for its
  minimal React-less template surface and the choice was made by the operator.
  Nothing in `src/lib/email.ts` is provider-specific beyond the SDK call, so
  swapping later is a one-file change.
- **No outbound auth email** (self-service reset disabled) — rejected: broken
  account recovery is not acceptable for the beta.
