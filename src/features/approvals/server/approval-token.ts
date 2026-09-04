import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureEnv } from "@/lib/env";

/**
 * Approval links (AF-M10-09).
 *
 * An approver gets an email with two links. The link has to authenticate them
 * without a session — they may not have an AutoFlow account at all — so it
 * carries a signed token rather than relying on one.
 *
 * Three properties, and each exists because of a specific way this goes wrong:
 *
 * - **Org-scoped.** The token names the organization, and the responder route
 *   checks it against the request's own. A token is a bearer credential; one
 *   that did not name its tenant would be a cross-tenant approval waiting for
 *   a copy-paste.
 * - **Expiring.** An approval link that works forever is a permanent grant
 *   sitting in someone's inbox. The expiry is inside the signed payload, so it
 *   cannot be extended by editing the URL.
 * - **Single-use.** Enforced by the request's own status transition, not by a
 *   separate "used" flag: a token is only valid while the request is `PENDING`,
 *   and answering it makes every token for it inert. One source of truth, and
 *   no way for the two to disagree.
 */

export interface ApprovalTokenPayload {
  approvalId: string;
  organizationId: string;
  decision: "APPROVED" | "REJECTED";
  /** Expiry, epoch seconds. */
  exp: number;
}

export class ApprovalTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalTokenError";
  }
}

const sign = (payload: string): string =>
  createHmac("sha256", ensureEnv().CREDENTIAL_MASTER_KEY)
    .update(payload)
    .digest("base64url");

export function signApprovalToken(payload: ApprovalTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verify and parse an approval token.
 *
 * Constant-time signature comparison: a `!==` on two strings leaks how many
 * leading characters matched, which is enough to forge a signature one
 * character at a time given enough attempts — and this token approves things.
 */
export function verifyApprovalToken(token: string): ApprovalTokenPayload {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    throw new ApprovalTokenError("This approval link is malformed.");
  }

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApprovalTokenError("This approval link is not valid.");
  }

  let payload: ApprovalTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    ) as ApprovalTokenPayload;
  } catch {
    throw new ApprovalTokenError("This approval link is malformed.");
  }

  if (
    typeof payload.approvalId !== "string" ||
    typeof payload.organizationId !== "string" ||
    (payload.decision !== "APPROVED" && payload.decision !== "REJECTED") ||
    typeof payload.exp !== "number"
  ) {
    throw new ApprovalTokenError("This approval link is malformed.");
  }

  if (payload.exp * 1000 < Date.now()) {
    throw new ApprovalTokenError(
      "This approval link has expired. Ask for a new one.",
    );
  }

  return payload;
}

/** Both links for one request, ready to drop into an email. */
export function approvalLinks(args: {
  approvalId: string;
  organizationId: string;
  expiresAt: Date;
  appUrl: string;
}): { approve: string; reject: string } {
  const exp = Math.floor(args.expiresAt.getTime() / 1000);
  const link = (decision: "APPROVED" | "REJECTED") =>
    `${args.appUrl}/approvals/respond?token=${encodeURIComponent(
      signApprovalToken({
        approvalId: args.approvalId,
        organizationId: args.organizationId,
        decision,
        exp,
      }),
    )}`;

  return { approve: link("APPROVED"), reject: link("REJECTED") };
}
