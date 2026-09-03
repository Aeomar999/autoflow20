import type { Role } from "@/lib/rbac";

/**
 * Presentation metadata for the four roles (AF-M6-04).
 *
 * Isomorphic and free of server imports so both the invite dialog and the
 * member table read the same labels — a role called "Editor" in one place and
 * "EDITOR" in another is how a permissions screen loses trust.
 *
 * The hierarchy itself lives in `src/lib/rbac.ts` and is enforced there. This
 * file is copy only; it grants nothing.
 */

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

/** What each role can actually do, in the user's terms, not the enum's. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER:
    "Full control, including billing and deleting the workspace. Cannot be assigned — ownership transfers separately.",
  ADMIN:
    "Everything an editor can do, plus managing members, credentials and API keys.",
  EDITOR: "Create, edit and run workflows. Cannot manage members or billing.",
  VIEWER: "Read-only access to workflows, executions and costs.",
};

/**
 * Roles the invite dialog and the role picker offer.
 *
 * `OWNER` is deliberately absent. `updateMemberRole` accepts it, but handing
 * out a second owner from a dropdown is an ownership transfer wearing a role
 * change's clothes, and the workspace-deletion path assumes a single owner.
 * Until a deliberate transfer flow exists, the UI does not offer it.
 */
export const ASSIGNABLE_ROLES: Role[] = ["ADMIN", "EDITOR", "VIEWER"];

/** Badge tone per role, so the highest privilege reads as the loudest. */
export const ROLE_BADGE_VARIANT: Record<
  Role,
  "default" | "secondary" | "outline"
> = {
  OWNER: "default",
  ADMIN: "default",
  EDITOR: "secondary",
  VIEWER: "outline",
};
