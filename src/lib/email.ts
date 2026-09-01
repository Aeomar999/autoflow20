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

interface AuthEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function verificationEmail(to: string, url: string): AuthEmail {
  return {
    to,
    subject: `Verify your email for ${brand}`,
    text: [
      `Welcome to ${brand}!`,
      "",
      "Confirm your email address to finish setting up your account:",
      url,
      "",
      "If you didn't create this account, you can safely ignore this email.",
    ].join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="margin-bottom:16px">Verify your email</h2>
      <p>Welcome to ${brand}! Confirm your email address to finish setting up your account.</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">Verify email</a></p>
      <p style="color:#71717a;font-size:12px">If the button doesn't work, paste this link: ${url}</p>
      <p style="color:#71717a;font-size:12px">If you didn't create this account, you can safely ignore this email.</p>
    </div>`,
  };
}

function passwordResetEmail(to: string, url: string): AuthEmail {
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
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
      <h2 style="margin-bottom:16px">Reset your password</h2>
      <p>We received a request to reset the password for your ${brand} account.</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
      <p style="color:#71717a;font-size:12px">If the button doesn't work, paste this link: ${url}</p>
      <p style="color:#71717a;font-size:12px">If you didn't request this, you can safely ignore this email. The link expires after one hour.</p>
    </div>`,
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
