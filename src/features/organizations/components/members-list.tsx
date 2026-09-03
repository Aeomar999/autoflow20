"use client";

import { TRPCClientError } from "@trpc/client";
import { formatDistanceToNow } from "date-fns";
import { MoreVerticalIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DataTable,
  rowActionClassName,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import {
  Panel,
  PanelActions,
  PanelHeader,
  PanelTitle,
} from "@/components/dashboard/panel";
import { EmptyView, ErrorView } from "@/components/entity-components";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import type { Role } from "@/lib/rbac";

import {
  useActiveOrganization,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from "../hooks/use-organizations";
import { ASSIGNABLE_ROLES, ROLE_BADGE_VARIANT, ROLE_LABELS } from "../roles";
import { InviteMemberDialog } from "./invite-member-dialog";

const COLUMNS = 5;

type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
};

/**
 * Member management (AF-M6-04).
 *
 * `organizationsRouter` has shipped `getMembers`, `updateMemberRole` and
 * `removeMember` since M6 with no way to reach any of them — a workspace
 * owner could not invite, promote or remove anybody from the product. This is
 * that surface.
 *
 * Every mutation here is an `orgAdminProcedure`, so the role gating below is
 * presentation: it stops a viewer being shown a control that would 403, and
 * removes nothing that the server was relying on the UI to prevent.
 */
export const MembersList = () => {
  const active = useActiveOrganization();
  const members = useMembers();
  const session = authClient.useSession();
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null);

  const canManage =
    active.data?.role === "OWNER" || active.data?.role === "ADMIN";
  const currentUserId = session.data?.user?.id;

  if (members.isError) {
    return <ErrorView message="Could not load the member list." />;
  }

  return (
    <>
      <Panel>
        <PanelHeader>
          <PanelTitle>
            Members
            {members.data ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                {members.data.length}
              </span>
            ) : null}
          </PanelTitle>
          {canManage ? (
            <PanelActions>
              <InviteMemberDialog />
            </PanelActions>
          ) : null}
        </PanelHeader>

        <DataTable>
          <THead>
            <tr>
              <TH>Member</TH>
              <TH className="hidden sm:table-cell">Email</TH>
              <TH>Role</TH>
              <TH className="hidden md:table-cell">Joined</TH>
              <TH align="right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {members.isLoading ? (
              <TableSkeleton columns={COLUMNS} rows={3} />
            ) : !members.data || members.data.length === 0 ? (
              <TableEmpty colSpan={COLUMNS}>
                <EmptyView
                  icon={UsersIcon}
                  title="No members yet"
                  message="Invite a teammate to share this workspace's workflows, credentials and executions."
                />
              </TableEmpty>
            ) : (
              members.data.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member as Member}
                  canManage={canManage}
                  isSelf={member.userId === currentUserId}
                  onRequestRemove={setPendingRemoval}
                />
              ))
            )}
          </TBody>
        </DataTable>
      </Panel>

      <RemoveMemberDialog
        member={pendingRemoval}
        onClose={() => setPendingRemoval(null)}
      />
    </>
  );
};

const MemberRow = ({
  member,
  canManage,
  isSelf,
  onRequestRemove,
}: {
  member: Member;
  canManage: boolean;
  isSelf: boolean;
  onRequestRemove: (member: Member) => void;
}) => {
  const updateRole = useUpdateMemberRole();

  // An owner's role is not editable from here, and neither is your own: both
  // are ways to lock every admin out of a workspace by accident. Ownership
  // transfer is a separate, deliberate flow (see `roles.ts`).
  const roleEditable = canManage && member.role !== "OWNER" && !isSelf;

  const changeRole = async (role: Role) => {
    if (role === member.role) return;
    try {
      // `memberId` is the Member row id, not the user id — the router keys the
      // membership lookup on it and scopes by org, so a member id from another
      // workspace cannot be targeted.
      await updateRole.mutateAsync({ memberId: member.id, role });
      toast.success(`${member.name} is now ${ROLE_LABELS[role].toLowerCase()}`);
    } catch (error) {
      toast.error(
        error instanceof TRPCClientError
          ? error.message
          : "Could not change that role",
      );
    }
  };

  return (
    <TR>
      <TD>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{member.name}</span>
          <span className="truncate text-xs text-muted-foreground sm:hidden">
            {member.email}
          </span>
        </div>
      </TD>
      <TD className="hidden sm:table-cell">
        <span className="truncate text-muted-foreground">{member.email}</span>
      </TD>
      <TD>
        <div className="flex items-center gap-2">
          <Badge variant={ROLE_BADGE_VARIANT[member.role]}>
            {ROLE_LABELS[member.role]}
          </Badge>
          {isSelf ? (
            <span className="text-xs text-muted-foreground">you</span>
          ) : null}
        </div>
      </TD>
      <TD className="hidden md:table-cell">
        <span className="text-muted-foreground">
          {formatDistanceToNow(new Date(member.createdAt), {
            addSuffix: true,
          })}
        </span>
      </TD>
      <TD align="right">
        {roleEditable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={rowActionClassName}
                aria-label={`Actions for ${member.name}`}
                disabled={updateRole.isPending}
              >
                <MoreVerticalIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Change role</DropdownMenuLabel>
              {ASSIGNABLE_ROLES.map((role) => (
                <DropdownMenuItem
                  key={role}
                  disabled={role === member.role}
                  onSelect={() => changeRole(role)}
                >
                  {ROLE_LABELS[role]}
                  {role === member.role ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      current
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onRequestRemove(member)}
              >
                Remove from workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TD>
    </TR>
  );
};

const RemoveMemberDialog = ({
  member,
  onClose,
}: {
  member: Member | null;
  onClose: () => void;
}) => {
  const remove = useRemoveMember();

  const confirm = async () => {
    if (!member) return;
    try {
      await remove.mutateAsync({ memberId: member.id });
      toast.success(`${member.name} was removed from the workspace`);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof TRPCClientError
          ? error.message
          : "Could not remove that member",
      );
    }
  };

  return (
    <AlertDialog open={!!member} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They lose access to this workspace immediately. Workflows,
            credentials and executions they created stay — this removes the
            person, not their work.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
            disabled={remove.isPending}
          >
            Remove member
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
