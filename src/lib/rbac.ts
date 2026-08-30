export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export function isRoleAtLeast(userRole: Role, requiredRole: Role): boolean {
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}

export type Action =
  | "workflows:read"
  | "workflows:write"
  | "workflows:publish"
  | "workflows:execute"
  | "credentials:read"
  | "credentials:write"
  | "executions:read"
  | "executions:cancel"
  | "members:read"
  | "members:invite"
  | "members:updateRole"
  | "members:remove"
  | "audit:read"
  | "org:update"
  | "org:delete"
  | "org:transferOwnership";

const ACTION_MIN_ROLE: Record<Action, Role> = {
  "workflows:read": "VIEWER",
  "workflows:write": "EDITOR",
  "workflows:publish": "EDITOR",
  "workflows:execute": "EDITOR",
  "credentials:read": "VIEWER",
  "credentials:write": "EDITOR",
  "executions:read": "VIEWER",
  "executions:cancel": "EDITOR",
  "members:read": "VIEWER",
  "members:invite": "ADMIN",
  "members:updateRole": "ADMIN",
  "members:remove": "ADMIN",
  "audit:read": "ADMIN",
  "org:update": "ADMIN",
  "org:delete": "OWNER",
  "org:transferOwnership": "OWNER",
};

export function canPerformAction(role: Role, action: Action): boolean {
  const minRole = ACTION_MIN_ROLE[action];
  if (!minRole) return false;
  return isRoleAtLeast(role, minRole);
}
