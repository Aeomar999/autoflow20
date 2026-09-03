import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationsRouter } from "@/features/organizations/server/routers";
import prisma from "@/lib/db";
import type { createTRPCContext } from "@/trpc/init";

/**
 * The member-management flow the AF-M6-04/05/07/09 UI drives, proven at the
 * data layer.
 *
 * The screens were the missing half of M6; the router was not. This locks the
 * round trip those screens depend on — invite → accept → member appears →
 * role change → removal — plus the two server behaviours the build added: the
 * `getActive` procedure the switcher and settings tabs read, and the
 * `acceptUrl`/`emailed` fields `inviteMember` now returns so the invite dialog
 * can show a copyable link when email delivery is off (as it is in this env).
 */
const h = vi.hoisted(() => {
  const owner = { id: "user_owner", email: "owner@test.local", name: "Owner" };
  const invitee = {
    id: "user_invitee",
    email: "invitee@test.local",
    name: "Invitee",
  };
  return {
    headerMap: new Map<string, string>(),
    currentUser: { ...owner } as { id: string; email: string; name: string },
    users: { owner, invitee },
  };
});

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: h.currentUser, session: {} })),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => h.headerMap),
}));

const dbUrl = process.env.TEST_DATABASE_URL;
const hasDb = Boolean(dbUrl);

describe.runIf(hasDb)("Organization members flow (AF-M6)", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const orgs = organizationsRouter.createCaller(mockCtx);

  let orgId: string;

  function asUser(user: { id: string; email: string; name: string }) {
    h.currentUser = { ...user };
    h.headerMap.clear();
    h.headerMap.set("x-organization-id", orgId);
  }

  beforeAll(() => {
    // Premium bypass, matching the org-isolation suite.
    process.env.E2E_SERVER = "1";
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "organization","member","invitation","workspace","audit_log","user","session","account","verification" CASCADE`,
    );
    await prisma.user.createMany({
      data: [h.users.owner, h.users.invitee],
    });
    const org = await prisma.organization.create({
      data: {
        name: "Acme",
        slug: "acme-members-integration",
        members: { create: { userId: h.users.owner.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    orgId = org.id;
    // Header points at the org only after it exists, so re-apply.
    h.currentUser = { ...h.users.owner };
    h.headerMap.clear();
    h.headerMap.set("x-organization-id", orgId);
  });

  it("getActive returns the resolved org and the caller's role", async () => {
    const active = await orgs.getActive();
    expect(active.id).toBe(orgId);
    expect(active.name).toBe("Acme");
    expect(active.role).toBe("OWNER");
  });

  it("inviteMember creates a pending invite and returns a copyable accept link", async () => {
    const result = await orgs.inviteMember({
      email: h.users.invitee.email,
      role: "EDITOR",
    });

    // The UI shows this link; email is unconfigured in the test env, so the
    // best-effort send reports false rather than throwing.
    expect(result.emailed).toBe(false);
    expect(result.acceptUrl).toContain("/accept-invite?token=");
    expect(result.acceptUrl).toContain(result.token);

    const invites = await orgs.listInvitations();
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe(h.users.invitee.email);
    expect(invites[0].role).toBe("EDITOR");
  });

  it("runs the full invite → accept → member round trip", async () => {
    const { token } = await orgs.inviteMember({
      email: h.users.invitee.email,
      role: "EDITOR",
    });

    // The invitee signs in and accepts.
    asUser(h.users.invitee);
    const accepted = await orgs.acceptInvite({ token });
    expect(accepted.organizationId).toBe(orgId);
    expect(accepted.organizationName).toBe("Acme");

    // Accepting consumes the invite and creates the membership.
    asUser(h.users.owner);
    expect(await orgs.listInvitations()).toHaveLength(0);

    const members = await orgs.getMembers();
    const invitee = members.find((m) => m.email === h.users.invitee.email);
    expect(invitee).toBeDefined();
    expect(invitee?.role).toBe("EDITOR");
  });

  it("changes a member's role and then removes them", async () => {
    const { token } = await orgs.inviteMember({
      email: h.users.invitee.email,
      role: "EDITOR",
    });
    asUser(h.users.invitee);
    await orgs.acceptInvite({ token });
    asUser(h.users.owner);

    const members = await orgs.getMembers();
    const memberId = members.find((m) => m.email === h.users.invitee.email)?.id;
    expect(memberId).toBeDefined();
    if (!memberId) throw new Error("member not found");

    await orgs.updateMemberRole({ memberId, role: "ADMIN" });
    const afterPromote = await orgs.getMembers();
    expect(
      afterPromote.find((m) => m.email === h.users.invitee.email)?.role,
    ).toBe("ADMIN");

    await orgs.removeMember({ memberId });
    const afterRemove = await orgs.getMembers();
    expect(afterRemove.some((m) => m.email === h.users.invitee.email)).toBe(
      false,
    );
  });

  it("records the invitation in the audit log the viewer reads", async () => {
    await orgs.inviteMember({
      email: h.users.invitee.email,
      role: "VIEWER",
    });

    const log = await orgs.listAuditLogs({ page: 1 });
    const inviteEntry = log.items.find((e) => e.action === "member.invite");
    expect(inviteEntry).toBeDefined();
    expect(inviteEntry?.resourceType).toBe("invitation");
  });
});
