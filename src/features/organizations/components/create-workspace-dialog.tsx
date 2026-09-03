"use client";

import { TRPCClientError } from "@trpc/client";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useCreateOrganization } from "../hooks/use-organizations";
import { setActiveOrganization } from "../lib/active-org";

/**
 * A URL-safe slug from a workspace name, with a short random suffix.
 *
 * The slug is globally unique and the create mutation rejects a collision
 * (CONFLICT). A user typing "Acme Ops" should not have to invent a unique
 * identifier, and two unrelated tenants naming their workspace "Ops" is
 * ordinary — the suffix makes an accidental collision vanishingly unlikely
 * while keeping the readable stem, and a genuine collision still surfaces as a
 * toast rather than silently. The server regex is `^[a-z0-9-]+$`, min length 2.
 */
function slugFromName(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return stem ? `${stem}-${suffix}` : `workspace-${suffix}`;
}

/**
 * Create a workspace and switch into it (AF-M6-07).
 *
 * Switching on create is the point: a workspace you cannot get into is not
 * created from the user's perspective, and the alternative is a toast saying
 * "created" while everything on screen still belongs to the old one.
 */
export const CreateWorkspaceDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [name, setName] = useState("");
  const create = useCreateOrganization();
  const router = useRouter();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the workspace a name");
      return;
    }

    try {
      const created = await create.mutateAsync({
        name: trimmed,
        slug: slugFromName(trimmed),
      });
      setActiveOrganization(created.id);
      setName("");
      onOpenChange(false);
      toast.success(`Switched to ${created.name}`);
      // `refresh`, not `push`: the active organization is resolved server-side
      // from the cookie just written, so every server component on the current
      // route has to re-render against the new tenant. A client-side navigation
      // would leave the old workspace's prefetched data on screen.
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof TRPCClientError
          ? error.message
          : "Could not create that workspace",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              Workspaces keep workflows, credentials and executions separate.
              Nothing is shared between them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              placeholder="Acme Ops"
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
