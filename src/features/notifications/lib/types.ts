import type { NotificationType } from "@/generated/prisma/browser";

/**
 * Client-safe notification shapes (AF-M7-08).
 *
 * Components import from here, never from `server/`.
 */

export interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
  workflowId: string | null;
  executionId: string | null;
}

/** How each kind is announced in the list. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  EXECUTION_FAILED: "Run failed",
  EXECUTION_SUCCEEDED: "Run finished",
  APPROVAL_REQUESTED: "Approval needed",
  CREDENTIAL_EXPIRING: "Credential expiring",
  SYSTEM: "System",
};

/**
 * The bell stops counting past this and renders "99+". A workspace with more
 * unread than this has a notification problem, not a counting problem.
 */
export const UNREAD_BADGE_CAP = 99;
