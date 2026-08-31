"use client";

import { formatDistanceToNow } from "date-fns";
import {
  BellIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  ClockIcon,
  KeyRoundIcon,
  ShieldQuestionIcon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  EmptyView,
  ErrorView,
  LoadingView,
} from "@/components/entity-components";
import { Button } from "@/components/ui/button";
import type { NotificationType } from "@/generated/prisma/browser";
import { cn } from "@/lib/utils";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "../hooks/use-notifications";
import { NOTIFICATION_TYPE_LABELS, type NotificationRow } from "../lib/types";

const PAGE_SIZE = 20;

const TYPE_ICONS: Record<
  NotificationType,
  React.ComponentType<{ className?: string }>
> = {
  EXECUTION_FAILED: XCircleIcon,
  EXECUTION_SUCCEEDED: CheckCircle2Icon,
  APPROVAL_REQUESTED: ShieldQuestionIcon,
  CREDENTIAL_EXPIRING: KeyRoundIcon,
  SYSTEM: BellIcon,
};

const TYPE_TONES: Record<NotificationType, string> = {
  EXECUTION_FAILED: "text-red-600",
  EXECUTION_SUCCEEDED: "text-green-600",
  APPROVAL_REQUESTED: "text-amber-600",
  CREDENTIAL_EXPIRING: "text-amber-600",
  SYSTEM: "text-muted-foreground",
};

export const NotificationsPage = () => {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const notifications = useNotifications({ filter, page, pageSize: PAGE_SIZE });
  const markAllRead = useMarkAllNotificationsRead();

  const setFilterAndReset = (next: "all" | "unread") => {
    setFilter(next);
    setPage(1);
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Run outcomes, approvals, and credential warnings for this workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilterAndReset("all")}
          >
            All
          </Button>
          <Button
            variant={filter === "unread" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilterAndReset("unread")}
          >
            Unread
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheckIcon className="size-4" />
            Mark all read
          </Button>
        </div>
      </div>

      {notifications.isPending && (
        <LoadingView message="Loading notifications..." />
      )}
      {notifications.isError && (
        <ErrorView message="Error loading notifications" />
      )}

      {notifications.data && notifications.data.items.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="mx-auto max-w-sm">
            <EmptyView
              icon={BellIcon}
              title={
                filter === "unread" ? "Nothing unread" : "No notifications"
              }
              message={
                filter === "unread"
                  ? "Everything here has been read."
                  : "Failed runs, approval requests, and expiring credentials show up here. Failure notices are on by default for every workflow."
              }
            />
          </div>
        </div>
      )}

      {notifications.data && notifications.data.items.length > 0 && (
        <ul className="divide-y rounded-md border bg-white">
          {notifications.data.items.map((item) => (
            <NotificationItem key={item.id} data={item} />
          ))}
        </ul>
      )}

      {!!notifications.data && notifications.data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {notifications.data.page} of {notifications.data.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!notifications.data.hasPreviousPage}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!notifications.data.hasNextPage}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

const NotificationItem = ({ data }: { data: NotificationRow }) => {
  const router = useRouter();
  const markRead = useMarkNotificationRead();
  const Icon = TYPE_ICONS[data.type] ?? BellIcon;
  const unread = data.readAt === null;

  const open = () => {
    if (unread) markRead.mutate({ id: data.id });
    if (data.href) router.push(data.href);
  };

  return (
    <li>
      <button
        type="button"
        onClick={open}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40",
          unread && "bg-accent/20",
        )}
      >
        <Icon className={cn("mt-0.5 size-5 shrink-0", TYPE_TONES[data.type])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{data.title}</span>
            {unread && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-blue-600"
              />
            )}
            <span className="sr-only">{unread ? "Unread" : "Read"}</span>
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {data.message}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ClockIcon className="size-3" aria-hidden />
            {formatDistanceToNow(data.createdAt, { addSuffix: true })}
            {" · "}
            {NOTIFICATION_TYPE_LABELS[data.type]}
          </p>
        </div>
      </button>
    </li>
  );
};
