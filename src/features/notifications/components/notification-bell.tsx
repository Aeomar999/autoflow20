"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { useUnreadNotificationCount } from "../hooks/use-notifications";
import { UNREAD_BADGE_CAP } from "../lib/types";

/**
 * Notification bell with unread badge (AF-M7-08).
 *
 * Lives in the sidebar header — this layout has no top header bar, and the
 * sidebar header is its equivalent region.
 */
export const NotificationBell = () => {
  const { data } = useUnreadNotificationCount();
  const count = data?.count ?? 0;
  const label =
    count > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(count);

  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative size-9 shrink-0"
    >
      <Link
        href="/notifications"
        prefetch
        aria-label={
          count === 0 ? "Notifications" : `Notifications, ${count} unread`
        }
      >
        <BellIcon className="size-4" />
        {count > 0 && (
          <span
            // aria-hidden: the count is already in the link's accessible name,
            // and a screen reader announcing it twice is worse than once.
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-medium leading-4 text-white tabular-nums"
          >
            {label}
          </span>
        )}
      </Link>
    </Button>
  );
};
