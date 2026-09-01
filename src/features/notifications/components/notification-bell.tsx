"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { useUnreadNotificationCount } from "../hooks/use-notifications";
import { UNREAD_BADGE_CAP } from "../lib/types";

/**
 * Notification bell with unread badge (AF-M7-08).
 *
 * Lives in the app header, beside search and the theme control. It used to sit
 * in the sidebar header because the layout had no top bar; it does now.
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
      className="relative size-8 shrink-0 rounded-md border border-hairline bg-panel text-muted-foreground hover:text-foreground"
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
            className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground tabular-nums"
          >
            {label}
          </span>
        )}
      </Link>
    </Button>
  );
};
