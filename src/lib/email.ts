import "server-only";

import { Resend } from "resend";
import { resendApiKey, resendFromEmail } from "@/lib/env";

/**
 * Transactional auth email (AF-M8-04) delivered via Resend.
 *
 * Server-only: never import this from a client component. It sends the two
 * Better Auth emails that keep the reset-password and email-verification
 * flows working. The `resend` SDK is used directly (no SMTP) — see ADR-0014.
 *
 * Sending is an explicit decision: when RESEND_API_KEY is unset the module
 * throws `ResendNotConfiguredError` so an auth action that NEEDS to send an
 * email fails loudly instead of silently pretending it worked. The recipient
 * address and URL are the only things that reach the Resend API; no token,
 * key, or password is ever logged.
 */

export class ResendNotConfiguredError extends Error {
  constructor() {
    super(
      "Auth email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
    );
    this.name = "ResendNotConfiguredError";
  }
}

const brand = "AutoFlow";

/*
 * Transactional auth email design (email-verification UI refresh).
 *
 * Inline-only CSS in table layout for the widest email-client support (Gmail,
 * Outlook, Apple Mail strip or mangle <style> blocks and complex SVG/gradients).
 * The header carries the AutoFlow orange wordmark, which is a flat geometric
 * mark that renders reliably everywhere. One accent (AutoFlow orange) locked
 * across both emails. No em-dash anywhere: see design-taste skill section 9G.
 */

/** AutoFlow wordmark (`public/logos/logo.svg`), inlined for email-safety. */
const wordmark = `
  <svg width="96" height="39" viewBox="0 0 78 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AutoFlow" style="display:block">
    <path d="M55.5 0H77.5L58.5 32H36.5L55.5 0Z" fill="#FF7A00"/>
    <path d="M35.5 0H51.5L32.5 32H16.5L35.5 0Z" fill="#FF9736"/>
    <path d="M19.5 0H31.5L12.5 32H0.5L19.5 0Z" fill="#FFBC7D"/>
  </svg>`;

interface AuthEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface EmailBody {
  heading: string;
  lead: string;
  ctaUrl: string;
  ctaLabel: string;
  safetyLine: string;
}

/** Shared shell, CTA + fallback + safety line. Table-based, inline styles. */
function wrapEmail(body: EmailBody): string {
  return `
  <div style="background-color:#fafafa;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr>
        <td style="padding:0 0 28px;">
          ${wordmark}
        </td>
      </tr>
      <tr>
        <td style="background-color:#ffffff;border-radius:16px;border:1px solid #e4e4e7;padding:36px 32px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:#18181b;letter-spacing:-0.01em;">
            ${body.heading}
          </h1>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#52525b;max-width:440px;">
            ${body.lead}
          </p>
          <a href="${body.ctaUrl}" style="display:inline-block;padding:13px 22px;background-color:#c2410c;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:1;border-radius:9999px;">
            ${body.ctaLabel}
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#71717a;">
            If the button doesn't work, paste this link into your browser:<br/>
            <a href="${body.ctaUrl}" style="color:#52525b;word-break:break-all;">${body.ctaUrl}</a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 4px 0;">
          <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#a1a1aa;">
            ${body.safetyLine}
          </p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa;">
            Sent by ${brand}. You are receiving this email because of activity on your ${brand} account.
          </p>
        </td>
      </tr>
    </table>
  </div>`;
}

function verificationEmail(to: string, url: string): AuthEmail {
  const body: EmailBody = {
    heading: "Verify your email",
    lead: `Welcome to ${brand}. Confirm your email address to finish setting up your account. This step keeps your account secure.`,
    ctaUrl: url,
    ctaLabel: "Verify email",
    safetyLine:
      "If you didn't create this account, you can safely ignore this email.",
  };
  return {
    to,
    subject: `Verify your email for ${brand}`,
    text: [
      `Confirm your email address for ${brand}:`,
      "",
      url,
      "",
      `If you didn't create this account, you can safely ignore this email.`,
    ].join("\n"),
    html: wrapEmail(body),
  };
}

function passwordResetEmail(to: string, url: string): AuthEmail {
  const body: EmailBody = {
    heading: "Reset your password",
    lead: `We received a request to reset the password for your ${brand} account. If this was you, choose a new password to continue.`,
    ctaUrl: url,
    ctaLabel: "Reset password",
    safetyLine:
      "If you didn't request this, you can safely ignore this email. The link expires after one hour.",
  };
  return {
    to,
    subject: `Reset your ${brand} password`,
    text: [
      `We received a request to reset the password for your ${brand} account.`,
      "",
      "Reset your password here:",
      url,
      "",
      "If you didn't request this, you can safely ignore this email. The link expires after one hour.",
    ].join("\n"),
    html: wrapEmail(body),
  };
}

async function sendAuthEmail(message: AuthEmail): Promise<void> {
  if (!resendApiKey) {
    throw new ResendNotConfiguredError();
  }
  const resend = new Resend(resendApiKey);
  const { error } = await resend.emails.send({
    from: resendFromEmail,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  if (error) {
    throw new Error(
      `Failed to send ${message.subject} email: ${error.message}`,
    );
  }
}

/** Better Auth `emailVerification.sendVerificationEmail` callback. */
export async function sendVerificationEmail(data: {
  user: { email: string };
  url: string;
}): Promise<void> {
  await sendAuthEmail(verificationEmail(data.user.email, data.url));
}

/** Better Auth `emailAndPassword.sendResetPassword` callback. */
export async function sendPasswordResetEmail(data: {
  user: { email: string };
  url: string;
}): Promise<void> {
  await sendAuthEmail(passwordResetEmail(data.user.email, data.url));
}
