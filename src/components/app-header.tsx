"use client";

import { ChevronRightIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { NAV_GROUPS } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { cn } from "@/lib/utils";

const SECTION_LABELS = new Map(
  NAV_GROUPS.flatMap((group) =>
    group.items.map((item) => [item.url.slice(1), item.title] as const),
  ),
);

/** Extra segments that are real pages but not nav destinations. */
const EXTRA_LABELS = new Map([
  ["new", "New"],
  ["billing", "Billing"],
  ["success", "Success"],
  // Reachable from the header bell rather than the nav, so it is not in
  // NAV_GROUPS and would otherwise be truncated as if it were a record id.
  ["notifications", "Notifications"],
]);

type Crumb = { label: string; href: string; isId: boolean };

const buildCrumbs = (pathname: string): Crumb[] => {
  const segments = pathname.split("/").filter(Boolean);

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join("/")}`;
    const known = SECTION_LABELS.get(segment) ?? EXTRA_LABELS.get(segment);

    if (known) return { label: known, href, isId: false };

    // Anything else is a record id. Showing a 24-character cuid in full pushes
    // the rest of the bar off screen, so it is truncated and set in mono.
    return {
      label: segment.length > 12 ? `${segment.slice(0, 8)}...` : segment,
      href,
      isId: true,
    };
  });
};

/**
 * The modifier the palette actually answers to on this machine. Resolved after
 * mount rather than during render: the server cannot know the platform, and
 * guessing would hydrate a different key cap than it rendered.
 */
const useShortcutKey = () => {
  const [key, setKey] = useState("Ctrl");

  useEffect(() => {
    if (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) {
      setKey("⌘");
    }
  }, []);

  return key;
};

export const AppHeader = () => {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);
  const shortcutKey = useShortcutKey();

  /** Open the global command palette by dispatching the same shortcut it
   *  already listens for. This keeps the palette mounted exactly once (in
   *  the dashboard layout) with no shared state plumbing needed. */
  const openPalette = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
      }),
    );
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-panel/85 px-3 backdrop-blur-sm md:px-4">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />

      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={crumb.href}>
              {index > 0 ? (
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground/50"
                />
              ) : null}
              {isLast ? (
                <span
                  aria-current="page"
                  className={cn(
                    "truncate text-sm font-medium text-primary",
                    crumb.isId && "font-mono text-xs",
                  )}
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className={cn(
                    "truncate text-sm text-muted-foreground transition-colors hover:text-foreground",
                    crumb.isId && "font-mono text-xs",
                  )}
                >
                  {crumb.label}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-8 items-center gap-2 rounded-md border border-hairline bg-well px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:w-56 md:w-72 lg:w-96"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">Go to page</span>
          <KbdGroup className="ml-auto hidden sm:flex">
            <Kbd>{shortcutKey}</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </button>
        <NotificationBell />
        <ThemeToggle />
      </div>
    </header>
  );
};
