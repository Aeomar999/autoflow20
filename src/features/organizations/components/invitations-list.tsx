"use client";

import { TRPCClientError } from "@trpc/client";
import { formatDistanceToNow } from "date-fns";
import { MailIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DataTable,
  TableEmpty,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/dashboard/data-table";
import { Panel, PanelHeader, PanelTitle } from "@/components/dashboard/panel";
import { EmptyView } from "@/components/entity-components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/rbac";

import {
  useCancelInvitation,
  useInvitations,
} from "../hooks/use-organizations";
import { ROLE_BADGE_VARIANT, ROLE_LABELS } from "../roles";

const COLUMNS = 4;

/**
 * Outstanding invitations (AF-M6-04).
 *
 * `listInvitations` already filters to `expiresAt > now`, so everything shown
 * here is still actionable — an expired invitation is not rendered as
 * "pending" when clicking its link would fail.
 *
 * Admin-only, like the router procedures behind it, so this component is only
 * mounted for admins by the members page rather than gating itself.
 */
export const InvitationsList = () => {
  const invitations = useInvitations();
  const cancel = useCancelInvitation();

  const cancelInvite = async (id: string, email: string) => {
    try {
      await cancel.mutateAsync({ id });
      toast.success(`Invitation to ${email} cancelled`);
    } catch (error) {
      toast.error(
        error instanceof TRPCClientError
          ? error.message
          : "Could not cancel that invitation",
      );
    }
  };

  // Nothing pending is the normal state, and an empty panel adds noise to the
  // page rather than information. Render nothing at all once loaded and empty.
  if (!invitations.isLoading && invitations.data?.length === 0) {
    return null;
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          Pending invitations
          {invitations.data ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
              {invitations.data.length}
            </span>
          ) : null}
        </PanelTitle>
      </PanelHeader>

      <DataTable>
        <THead>
          <tr>
            <TH>Email</TH>
            <TH>Role</TH>
            <TH className="hidden sm:table-cell">Expires</TH>
            <TH align="right">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {invitations.isLoading ? (
            <TableSkeleton columns={COLUMNS} rows={2} />
          ) : !invitations.data || invitations.data.length === 0 ? (
            <TableEmpty colSpan={COLUMNS}>
              <EmptyView
                icon={MailIcon}
                title="No pending invitations"
                message="Invitations you send appear here until they are accepted or expire."
              />
            </TableEmpty>
          ) : (
            invitations.data.map((invite) => (
              <TR key={invite.id}>
                <TD>
                  <span className="truncate font-medium">{invite.email}</span>
                </TD>
                <TD>
                  <Badge variant={ROLE_BADGE_VARIANT[invite.role as Role]}>
                    {ROLE_LABELS[invite.role as Role]}
                  </Badge>
                </TD>
                <TD className="hidden sm:table-cell">
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(invite.expiresAt), {
                      addSuffix: true,
                    })}
                  </span>
                </TD>
                <TD align="right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={cancel.isPending}
                    onClick={() => cancelInvite(invite.id, invite.email)}
                  >
                    <XIcon className="size-3.5" />
                    Cancel
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </DataTable>
    </Panel>
  );
};
