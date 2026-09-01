import type { NotificationType } from "@/generated/prisma/browser";

/**
 * Notification construction (AF-M7-08).
 *
 * Pure: no Prisma, no dates-from-now, no I/O — so every dedupe key and every
 * line of copy is unit-testable, and the runner tail can build a notification
 * without reaching for a database.
 */

/** Everything needed to write one row, minus the org scope. */
export interface NotificationDraft {
  type: NotificationType;
  title: string;
  message: string;
  href: string | null;
  dedupeKey: string;
  workflowId: string | null;
  executionId: string | null;
  credentialId: string | null;
}

/**
 * Dedupe keys are composed from the LOGICAL EVENT, never from a timestamp.
 *
 * This is what makes the writers safe to replay: Inngest re-runs a step whose
 * memo it lost, `onFailure` can fire alongside a partial tail, and a cron runs
 * again on every redeploy. Keyed this way, a replay collides with the row it
 * already wrote and is skipped, instead of announcing the same thing twice.
 */
export function executionDedupeKey(
  executionId: string,
  type: "EXECUTION_FAILED" | "EXECUTION_SUCCEEDED",
): string {
  return `execution:${executionId}:${type}`;
}

/**
 * Keyed on the expiry instant, not the day the cron happened to run. A daily
 * sweep therefore announces a given expiry exactly once — and if the token is
 * refreshed, the new expiry is a new key and a genuinely new warning.
 */
export function credentialDedupeKey(
  credentialId: string,
  expiresAt: Date,
): string {
  return `credential:${credentialId}:expiring:${expiresAt.toISOString()}`;
}

export function approvalDedupeKey(approvalRequestId: string): string {
  return `approval:${approvalRequestId}`;
}

/**
 * Keyed on an operator-chosen announcement id AND the organization (AF-M8-13).
 *
 * A system announcement has no row of its own to key on, so the operator
 * supplies the identity. That is the idempotency story for a broadcast:
 * sending "scheduled maintenance on the 14th" to 400 organizations and then
 * re-running the script - because it half-failed, or because nobody was sure
 * it went - must reach only the workspaces that missed it.
 *
 * **The organization id has to be in the key**, and this is the first
 * notification type where that is true. `Notification.dedupeKey` is globally
 * `@unique`, not unique per organization. Every other producer gets away with
 * that because its key embeds a globally-unique row id - `execution:<cuid>`,
 * `credential:<cuid>`, `approval:<cuid>` - and each of those rows belongs to
 * exactly one organization, so global uniqueness and per-organization
 * uniqueness happened to coincide. A system announcement is the first
 * notification with no owning row, so without the organization here a
 * broadcast would write to the first workspace and be silently skipped for
 * every other one.
 *
 * It is deliberately not derived from the title: fixing a typo in the copy and
 * re-sending should reach the people who never saw the first version, not
 * silently do nothing because the text changed.
 */
export function systemDedupeKey(
  announcementId: string,
  organizationId: string,
): string {
  return `system:${announcementId}:${organizationId}`;
}

export function buildExecutionNotification(params: {
  executionId: string;
  workflowId: string;
  workflowName: string;
  succeeded: boolean;
  /** The run's error, when it failed. Truncated — the detail page has it all. */
  error?: string | null;
}): NotificationDraft {
  const type: NotificationType = params.succeeded
    ? "EXECUTION_SUCCEEDED"
    : "EXECUTION_FAILED";

  return {
    type,
    title: params.succeeded
      ? `${params.workflowName} finished`
      : `${params.workflowName} failed`,
    message: params.succeeded
      ? "The run completed successfully."
      : summarizeError(params.error),
    href: `/executions/${params.executionId}`,
    dedupeKey: executionDedupeKey(params.executionId, type),
    workflowId: params.workflowId,
    executionId: params.executionId,
    credentialId: null,
  };
}

/** Cap on error text carried into a notification title bar. */
const ERROR_PREVIEW_LIMIT = 200;

/**
 * One readable line from a run's error.
 *
 * Only the first line: a stack trace in a notification list is noise, and the
 * execution detail page already holds the full trace. Never returns an empty
 * string — a notification whose body is blank tells the user nothing.
 */
export function summarizeError(error?: string | null): string {
  const firstLine = (error ?? "").split("\n")[0].trim();
  if (firstLine.length === 0) {
    return "The run failed. Open it to see the failing node.";
  }
  return firstLine.length > ERROR_PREVIEW_LIMIT
    ? `${firstLine.slice(0, ERROR_PREVIEW_LIMIT - 1)}…`
    : firstLine;
}

export function buildCredentialExpiryNotification(params: {
  credentialId: string;
  credentialName: string;
  expiresAt: Date;
  /** Whole days until expiry; negative when it has already lapsed. */
  daysRemaining: number;
}): NotificationDraft {
  const lapsed = params.daysRemaining < 0;

  return {
    type: "CREDENTIAL_EXPIRING",
    title: lapsed
      ? `${params.credentialName} has expired`
      : `${params.credentialName} expires in ${describeDays(params.daysRemaining)}`,
    message: lapsed
      ? "Workflows using this credential will fail until it is reconnected."
      : "Reconnect it before it lapses to avoid failed runs.",
    href: `/credentials/${params.credentialId}`,
    dedupeKey: credentialDedupeKey(params.credentialId, params.expiresAt),
    workflowId: null,
    executionId: null,
    credentialId: params.credentialId,
  };
}

function describeDays(days: number): string {
  if (days === 0) return "less than a day";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function buildApprovalNotification(params: {
  approvalRequestId: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  nodeName: string;
}): NotificationDraft {
  return {
    type: "APPROVAL_REQUESTED",
    title: `${params.workflowName} is waiting for approval`,
    message: `"${params.nodeName}" needs a decision before the run can continue.`,
    href: `/executions/${params.executionId}`,
    dedupeKey: approvalDedupeKey(params.approvalRequestId),
    workflowId: params.workflowId,
    executionId: params.executionId,
    credentialId: null,
  };
}

/**
 * An operator announcement: maintenance, an incident, a deprecation.
 *
 * Unlike every other notification type this one has no originating row, so it
 * carries no `workflowId`, `executionId`, or `credentialId`. The copy is the
 * operator's, verbatim - this builder deliberately does not template or
 * decorate it, because an announcement that says something other than what the
 * operator typed is worse than no announcement.
 */
export function buildSystemNotification(params: {
  announcementId: string;
  organizationId: string;
  title: string;
  message: string;
  href?: string | null;
}): NotificationDraft {
  return {
    type: "SYSTEM",
    title: params.title,
    message: params.message,
    href: params.href ?? null,
    dedupeKey: systemDedupeKey(params.announcementId, params.organizationId),
    workflowId: null,
    executionId: null,
    credentialId: null,
  };
}

/**
 * Whole days between two instants, floored.
 *
 * Floored rather than rounded so a warning never overstates the time left: at
 * 47 hours this says "1 day", which is the safe direction to be wrong in.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
