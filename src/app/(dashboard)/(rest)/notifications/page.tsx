import { NotificationsPage } from "@/features/notifications/components/notifications";
import { requireAuth } from "@/lib/auth-utils";

const Page = async () => {
  await requireAuth();
  return <NotificationsPage />;
};

export default Page;
