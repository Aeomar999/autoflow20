"use client";

import {
  BookOpenIcon,
  ChevronsUpDownIcon,
  CoinsIcon,
  CreditCardIcon,
  FolderOpenIcon,
  HistoryIcon,
  KeyIcon,
  LayoutTemplateIcon,
  LineChartIcon,
  LogOutIcon,
  SparklesIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useOrganizations } from "@/features/organizations/hooks/use-organizations";
import { useHasActiveSubscription } from "@/features/subscriptions/hooks/use-subscription";
import { authClient } from "@/lib/auth-client";
import { polarProductSlug } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Grouped navigation.
 *
 * Every label and URL is unchanged from the flat list this replaced, so
 * bookmarks, muscle memory and anything keyed on nav labels keep working. The
 * groups exist because seven equal items gave no clue which page answers which
 * question.
 */
export const NAV_GROUPS = [
  {
    label: "Build",
    items: [
      { title: "Workflows", icon: FolderOpenIcon, url: "/workflows" },
      { title: "Templates", icon: LayoutTemplateIcon, url: "/templates" },
    ],
  },
  {
    label: "Operate",
    items: [
      { title: "Executions", icon: HistoryIcon, url: "/executions" },
      { title: "Monitoring", icon: LineChartIcon, url: "/monitoring" },
      { title: "Costs", icon: CoinsIcon, url: "/costs" },
    ],
  },
  {
    label: "Library",
    items: [
      { title: "Credentials", icon: KeyIcon, url: "/credentials" },
      { title: "Knowledge Base", icon: BookOpenIcon, url: "/knowledge" },
    ],
  },
] as const;

const initialsOf = (value: string) =>
  value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";

/**
 * Workspace card. The small line names what the big line is, which is the only
 * arrangement that survives an org called "Billing" or "Ops".
 *
 * There is no switcher yet: the active organization is resolved server-side
 * from an `x-organization-id` header with an owner-membership fallback, and
 * nothing persists a choice, so a chevron here would open a menu that cannot
 * change anything.
 */
const WorkspaceCard = () => {
  const { data: organizations, isLoading } = useOrganizations();
  const workspace = organizations?.[0];

  return (
    <Link
      href="/"
      prefetch
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2 transition-colors hover:bg-sidebar-accent",
        "group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 ring-1 ring-primary/25">
        <Image
          src="/logos/autoflow-327.svg"
          alt=""
          width={18}
          height={18}
          priority
        />
      </span>
      <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
        <span className="truncate text-[11px] leading-tight text-muted-foreground">
          Workspace
        </span>
        <span className="truncate text-sm leading-tight font-semibold">
          {isLoading ? "Loading" : (workspace?.name ?? "AutoFlow")}
        </span>
      </span>
    </Link>
  );
};

const AccountCard = () => {
  const router = useRouter();
  const { hasActiveSubscription, isLoading } = useHasActiveSubscription();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const session = authClient.useSession();

  const user = session.data?.user;
  const name = user?.name || user?.email || "Your account";
  const email = user?.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2 text-left transition-colors hover:bg-sidebar-accent",
            "group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0",
          )}
        >
          <Avatar className="size-8 shrink-0 rounded-md">
            {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback className="rounded-md bg-primary/12 text-[11px] font-semibold text-primary">
              {initialsOf(name)}
            </AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm leading-tight font-medium">
              {name}
            </span>
            <span className="truncate text-[11px] leading-tight text-muted-foreground">
              {isLoading
                ? "Loading plan"
                : hasActiveSubscription
                  ? "Pro plan"
                  : "Free plan"}
            </span>
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {email ? (
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {!hasActiveSubscription && !isLoading && (
          <DropdownMenuItem
            onClick={() => authClient.checkout({ slug: polarProductSlug })}
            className="gap-2 text-primary focus:text-primary"
          >
            <SparklesIcon className="size-4" />
            Upgrade to Pro
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => authClient.customer.portal()}
          className="gap-2"
        >
          <CreditCardIcon className="size-4" />
          Billing portal
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isSigningOut}
          className="gap-2"
          onClick={() => {
            setIsSigningOut(true);
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => router.push("/login"),
                onError: () => setIsSigningOut(false),
              },
            });
          }}
        >
          <LogOutIcon className="size-4" />
          {isSigningOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const AppSidebar = () => {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="border-hairline">
      <SidebarHeader className="border-b border-sidebar-border p-2">
        <WorkspaceCard />
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {NAV_GROUPS.map((group, index) => (
          <SidebarGroup
            key={group.label}
            className={cn(
              "py-3",
              // A rule between groups, not around every one, so the rail reads
              // as three sections rather than three boxes.
              index > 0 && "border-t border-sidebar-border",
            )}
          >
            <SidebarGroupLabel className="h-6 px-2 text-xs font-normal text-muted-foreground">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={pathname.startsWith(item.url)}
                      asChild
                      className={cn(
                        "h-10 gap-3 px-2 text-sidebar-foreground/80",
                        "data-[active=true]:bg-primary/10 data-[active=true]:font-medium data-[active=true]:text-primary",
                      )}
                    >
                      <Link href={item.url} prefetch>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <AccountCard />
      </SidebarFooter>
    </Sidebar>
  );
};
