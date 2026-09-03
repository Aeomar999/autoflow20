"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { useActiveOrganization } from "../hooks/use-organizations";

/**
 * Tab bar for the settings area (AF-M6-04/05/08).
 *
 * The audit-log tab is admin-only — it links to an `orgAdminProcedure`, so a
 * viewer following it would only meet a permission error. It is hidden rather
 * than shown-and-erroring, while the underlying route stays protected on the
 * server regardless of what the nav renders.
 */
const BASE_TABS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/members", label: "Members" },
] as const;

const ADMIN_TABS = [
  { href: "/settings/audit-logs", label: "Audit log" },
] as const;

export const SettingsNav = () => {
  const pathname = usePathname();
  const active = useActiveOrganization();
  const isAdmin =
    active.data?.role === "OWNER" || active.data?.role === "ADMIN";

  const tabs = [...BASE_TABS, ...(isAdmin ? ADMIN_TABS : [])];

  return (
    <nav className="flex gap-1 border-b border-hairline">
      {tabs.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              current
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
};
