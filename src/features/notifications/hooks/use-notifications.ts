"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useTRPC } from "@/trpc/client";

/** How often the bell re-checks. Slow enough not to be a poll storm. */
const UNREAD_POLL_MS = 60_000;

export const useUnreadNotificationCount = () => {
  const trpc = useTRPC();

  return useQuery({
    ...trpc.notifications.unreadCount.queryOptions(),
    refetchInterval: UNREAD_POLL_MS,
    // A run that fails while the tab is in the background is exactly the case
    // this feature exists for, so pick the count back up on focus.
    refetchOnWindowFocus: true,
  });
};

export const useNotifications = (input: {
  filter: "all" | "unread";
  page: number;
  pageSize: number;
}) => {
  const trpc = useTRPC();
  return useQuery(trpc.notifications.list.queryOptions(input));
};

/** Invalidate both the list and the badge — they read the same rows. */
function useInvalidateNotifications() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries(trpc.notifications.list.queryFilter());
    queryClient.invalidateQueries(
      trpc.notifications.unreadCount.queryOptions(),
    );
  };
}

export const useMarkNotificationRead = () => {
  const trpc = useTRPC();
  const invalidate = useInvalidateNotifications();

  return useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: invalidate,
      onError: (error) => toast.error(error.message),
    }),
  );
};

export const useMarkAllNotificationsRead = () => {
  const trpc = useTRPC();
  const invalidate = useInvalidateNotifications();

  return useMutation(
    trpc.notifications.markAllRead.mutationOptions({
      onSuccess: (data) => {
        invalidate();
        toast.success(
          data.updated === 0
            ? "Nothing unread"
            : `Marked ${data.updated} as read`,
        );
      },
      onError: (error) => toast.error(error.message),
    }),
  );
};
