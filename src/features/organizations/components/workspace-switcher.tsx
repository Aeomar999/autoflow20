"use client";

import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  useActiveOrganization,
  useOrganizations,
} from "../hooks/use-organizations";
import { setActiveOrganization } from "../lib/active-org";
import { ROLE_LABELS } from "../roles";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

/**
 * Workspace switcher for the sidebar (AF-M6-07).
 *
 * Replaces the static `WorkspaceCard`, which showed `organizations[0]` —
 * not necessarily the active one — and whose own comment read "There is no
 * switcher yet: … nothing persists a choice". The choice does persist: the
 * server has always read an `autoflow_active_org` cookie and verified
 * membership before honouring it; nothing wrote it. See `lib/active-org.ts`.
 *
 * The trigger keeps the original card's shape and collapsed-rail behaviour so
 * the sidebar layout is unchanged — this adds a menu, it does not restyle the
 * chrome around it.
 */
export const WorkspaceSwitcher = () => {
  const organizations = useOrganizations();
  const active = useActiveOrganization();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const activeId = active.data?.id;
  // Prefer the server's answer; fall back to the membership list only while
  // `getActive` is in flight, so the name never flickers to the wrong org.
  const current =
    organizations.data?.find((org) => org.id === activeId) ??
    organizations.data?.[0];

  const switchTo = (organizationId: string) => {
    if (organizationId === activeId) return;
    setActiveOrganization(organizationId);
    // Every server component on the route resolved its data against the old
    // tenant, so the whole tree has to re-render rather than just this menu.
    router.refresh();
  };

  const label =
    active.isLoading && !current ? "Loading" : (current?.name ?? "AutoFlow");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-accent/40 p-2 text-left transition-colors hover:bg-sidebar-accent",
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
            <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[11px] leading-tight text-muted-foreground">
                Workspace
              </span>
              <span className="truncate text-sm leading-tight font-semibold">
                {label}
              </span>
            </span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {organizations.data?.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onSelect={() => switchTo(org.id)}
              className="gap-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{org.name}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {ROLE_LABELS[org.role]}
                </span>
              </span>
              {org.id === activeId ? (
                <CheckIcon className="size-3.5 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <PlusIcon className="size-4" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
};
