"use client";

import { TRPCClientError } from "@trpc/client";
import { CheckIcon, CopyIcon, Loader2Icon, UserPlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/lib/rbac";

import { useInviteMember } from "../hooks/use-organizations";
import { ASSIGNABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS } from "../roles";

/**
 * Invite someone into the workspace (AF-M6-04).
 *
 * The role picker carries each role's description inline rather than in a
 * tooltip: choosing a permission level is the whole decision being made here,
 * and "ADMIN" on its own does not say what it grants.
 */
export const InviteMemberDialog = () => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("EDITOR");
  const [sent, setSent] = useState<{ url: string; emailed: boolean } | null>(
    null,
  );
  const invite = useInviteMember();

  const reset = () => {
    setEmail("");
    setRole("EDITOR");
    setSent(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      toast.error("Enter an email address to invite");
      return;
    }

    try {
      const result = await invite.mutateAsync({ email: email.trim(), role });
      // Do NOT close on success: the accept link is the reliable delivery
      // channel (email is best-effort and off in dev), so it is shown for the
      // admin to copy rather than assumed to have arrived by email.
      setSent({ url: result.acceptUrl, emailed: result.emailed });
    } catch (error) {
      // The hook has no `onError`, so without this the dialog would sit open
      // with no explanation — the exact silent failure `engineering_rules.md`
      // calls the top-priority defect class. Server messages here are
      // actionable ("already a member", "already invited"), so they are shown
      // rather than replaced with a generic string.
      toast.error(
        error instanceof TRPCClientError
          ? error.message
          : "Could not send that invitation",
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlusIcon className="size-4" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        {sent ? (
          <InviteSent
            url={sent.url}
            emailed={sent.emailed}
            onInviteAnother={reset}
            onDone={() => {
              setOpen(false);
              reset();
            }}
          />
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Invite a member</DialogTitle>
              <DialogDescription>
                They get a link to join this workspace. If email is configured
                it is sent for you; either way you can copy the link here.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  autoComplete="off"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(next) => setRole(next as Role)}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_ROLES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {ROLE_DESCRIPTIONS[role]}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={invite.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                Send invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const InviteSent = ({
  url,
  emailed,
  onInviteAnother,
  onDone,
}: {
  url: string;
  emailed: boolean;
  onInviteAnother: () => void;
  onDone: () => void;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The link is
      // visible and selectable in the field, so this is a convenience, not the
      // only way to get it — surface the failure without treating it as fatal.
      toast.error("Could not copy — select the link and copy it manually");
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Invitation ready</DialogTitle>
        <DialogDescription>
          {emailed
            ? "We emailed the invite. You can also share this link directly."
            : "Share this link with the person you're inviting. Email delivery isn't configured, so the link is the way in."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-2 py-4">
        <Input readOnly value={url} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onInviteAnother}>
          Invite another
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
};
