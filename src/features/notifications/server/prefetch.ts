import { prefetch, trpc } from "@/trpc/server";

/** Prefetch the bell badge so it does not pop in after the shell renders. */
export const prefetchUnreadNotificationCount = () => {
  return prefetch(trpc.notifications.unreadCount.queryOptions());
};
