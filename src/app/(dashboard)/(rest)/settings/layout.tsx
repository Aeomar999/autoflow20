import { DashboardPage, PageHeader } from "@/components/dashboard/page";
import { SettingsNav } from "@/features/organizations/components/settings-nav";
import { requireAuth } from "@/lib/auth-utils";

/**
 * Settings area shell (AF-M6-04/05/08).
 *
 * One frame and one tab bar shared by profile, members and audit-log, so the
 * three read as a single settings surface rather than three unrelated pages.
 * `requireAuth` here covers every child route in one place.
 */
const SettingsLayout = async ({ children }: { children: React.ReactNode }) => {
  await requireAuth();

  return (
    <DashboardPage>
      <PageHeader
        title="Settings"
        description="Manage your profile, your workspace members, and its audit trail."
      />
      <SettingsNav />
      <div className="mt-4">{children}</div>
    </DashboardPage>
  );
};

export default SettingsLayout;
