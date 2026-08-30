import { describe, expect, it } from "vitest";
import { canPerformAction, isRoleAtLeast } from "./rbac";

describe("RBAC Permissions", () => {
  describe("isRoleAtLeast", () => {
    it("correctly evaluates hierarchy", () => {
      expect(isRoleAtLeast("OWNER", "OWNER")).toBe(true);
      expect(isRoleAtLeast("OWNER", "ADMIN")).toBe(true);
      expect(isRoleAtLeast("OWNER", "EDITOR")).toBe(true);
      expect(isRoleAtLeast("OWNER", "VIEWER")).toBe(true);

      expect(isRoleAtLeast("ADMIN", "OWNER")).toBe(false);
      expect(isRoleAtLeast("ADMIN", "ADMIN")).toBe(true);
      expect(isRoleAtLeast("ADMIN", "EDITOR")).toBe(true);
      expect(isRoleAtLeast("ADMIN", "VIEWER")).toBe(true);

      expect(isRoleAtLeast("EDITOR", "ADMIN")).toBe(false);
      expect(isRoleAtLeast("EDITOR", "EDITOR")).toBe(true);
      expect(isRoleAtLeast("EDITOR", "VIEWER")).toBe(true);

      expect(isRoleAtLeast("VIEWER", "EDITOR")).toBe(false);
      expect(isRoleAtLeast("VIEWER", "VIEWER")).toBe(true);
    });
  });

  describe("canPerformAction", () => {
    it("allows VIEWER to read only", () => {
      expect(canPerformAction("VIEWER", "workflows:read")).toBe(true);
      expect(canPerformAction("VIEWER", "credentials:read")).toBe(true);
      expect(canPerformAction("VIEWER", "executions:read")).toBe(true);
      expect(canPerformAction("VIEWER", "members:read")).toBe(true);

      expect(canPerformAction("VIEWER", "workflows:write")).toBe(false);
      expect(canPerformAction("VIEWER", "workflows:execute")).toBe(false);
      expect(canPerformAction("VIEWER", "credentials:write")).toBe(false);
      expect(canPerformAction("VIEWER", "members:invite")).toBe(false);
      expect(canPerformAction("VIEWER", "audit:read")).toBe(false);
    });

    it("allows EDITOR to write resources but not manage org", () => {
      expect(canPerformAction("EDITOR", "workflows:write")).toBe(true);
      expect(canPerformAction("EDITOR", "workflows:publish")).toBe(true);
      expect(canPerformAction("EDITOR", "workflows:execute")).toBe(true);
      expect(canPerformAction("EDITOR", "credentials:write")).toBe(true);

      expect(canPerformAction("EDITOR", "members:invite")).toBe(false);
      expect(canPerformAction("EDITOR", "members:updateRole")).toBe(false);
      expect(canPerformAction("EDITOR", "audit:read")).toBe(false);
    });

    it("allows ADMIN to manage members and audit logs", () => {
      expect(canPerformAction("ADMIN", "members:invite")).toBe(true);
      expect(canPerformAction("ADMIN", "members:remove")).toBe(true);
      expect(canPerformAction("ADMIN", "audit:read")).toBe(true);
      expect(canPerformAction("ADMIN", "org:update")).toBe(true);

      expect(canPerformAction("ADMIN", "org:delete")).toBe(false);
      expect(canPerformAction("ADMIN", "org:transferOwnership")).toBe(false);
    });

    it("allows OWNER all actions", () => {
      expect(canPerformAction("OWNER", "org:delete")).toBe(true);
      expect(canPerformAction("OWNER", "org:transferOwnership")).toBe(true);
      expect(canPerformAction("OWNER", "audit:read")).toBe(true);
      expect(canPerformAction("OWNER", "workflows:write")).toBe(true);
    });
  });
});
