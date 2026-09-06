import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { employeesRouter } from "@/features/employees/server/routers";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import type { createTRPCContext } from "@/trpc/init";

/**
 * AF-M11-11 — employee lifecycle: tenancy, handoff guards, audit trail.
 *
 * Everything here runs through the real `employeesRouter` and the real
 * `applyEmployeeHandoff`, against a real Postgres. The three things this
 * milestone must not get wrong, and which no unit test can prove because they
 * all depend on the database's own scoping and constraints:
 *
 *  1. **Tenancy** — org B cannot read or mutate org A's people, and the two
 *     orgs can hold the same `employeeRef` without colliding (the uniqueness
 *     is `@@unique([organizationId, employeeRef])`, not global).
 *  2. **Guards** — a replayed handoff is `already-current`, an out-of-sequence
 *     one is `conflict`, and neither throws. A workflow branches on the
 *     outcome; a 500 would take the run down instead.
 *  3. **Audit** — every mutation leaves a row, and neither the audit payload
 *     nor the warn log carries a name, an email, or anything else personal.
 *
 * Session/org resolution is mocked the same way `org-isolation` does it, so a
 * bare `{}` context is enough.
 */

const h = vi.hoisted(() => {
  const userA = { id: "user_empa", email: "empa@test.local", name: "Emp A" };
  const userB = { id: "user_empb", email: "empb@test.local", name: "Emp B" };
  return {
    headerMap: new Map<string, string>(),
    currentUser: { ...userA },
    users: { userA, userB },
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

const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/** Personal data that must never reach a log line or an error message. */
const PII = {
  fullName: "Ada Boateng",
  email: "ada.boateng@example.com",
  personalEmail: "ada.personal@example.com",
  managerEmail: "grace.hopper@example.com",
};

describe.runIf(hasDb)("Employee lifecycle (AF-M11-11)", () => {
  const mockCtx = {} as unknown as ReturnType<typeof createTRPCContext>;
  const employees = employeesRouter.createCaller(mockCtx);

  let orgAId: string;
  let orgBId: string;
  let empAId: string;

  beforeAll(() => {
    process.env.E2E_SERVER = "1";
  });

  afterAll(() => {
    delete process.env.E2E_SERVER;
  });

  function asUser(
    user: { id: string; email: string; name: string },
    orgHeader?: string,
  ) {
    h.currentUser = { ...user };
    h.headerMap.clear();
    if (orgHeader) h.headerMap.set("x-organization-id", orgHeader);
  }

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "employee","audit_log","organization","member","invitation","workspace","user","session","account","verification" CASCADE`,
    );
    asUser(h.users.userA);

    await prisma.user.createMany({ data: [h.users.userA, h.users.userB] });

    const orgA = await prisma.organization.create({
      data: {
        name: "Emp Org A",
        slug: "empa-integration",
        members: { create: { userId: h.users.userA.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    const orgB = await prisma.organization.create({
      data: {
        name: "Emp Org B",
        slug: "empb-integration",
        members: { create: { userId: h.users.userB.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    orgAId = orgA.id;
    orgBId = orgB.id;

    const empA = await employees.create({
      employeeRef: "EMP-SHARED-001",
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
      department: "Sales",
      managerEmail: PII.managerEmail,
      personalEmail: PII.personalEmail,
      startDate: "2026-11-01",
    });
    empAId = empA.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Tenancy
  // -------------------------------------------------------------------------

  it("scopes the employee list to the caller's own org", async () => {
    asUser(h.users.userA);
    const listA = await employees.list({});
    expect(listA.totalCount).toBe(1);
    expect(listA.items[0]?.id).toBe(empAId);

    asUser(h.users.userB);
    const listB = await employees.list({});
    expect(listB.totalCount).toBe(0);
    expect(listB.items).toEqual([]);
  });

  it("returns NOT_FOUND — not FORBIDDEN — on a cross-org read", async () => {
    asUser(h.users.userB);
    // FORBIDDEN would confirm the row exists. NOT_FOUND leaks nothing.
    await expect(employees.getById({ id: empAId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses a cross-org patch and leaves the row untouched", async () => {
    asUser(h.users.userB);
    await expect(
      employees.patch({ id: empAId, role: "Hijacked" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(row.role).toBe("Account Executive");
    expect(row.organizationId).toBe(orgAId);
  });

  it("refuses a cross-org read even when the org header is spoofed", async () => {
    // User B is not a member of org A, so naming it in the header must not
    // widen anything: resolution falls back to B's own org.
    asUser(h.users.userB, orgAId);
    await expect(employees.getById({ id: empAId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets two orgs hold the same employeeRef without colliding", async () => {
    asUser(h.users.userB);
    const empB = await employees.create({
      employeeRef: "EMP-SHARED-001",
      email: PII.email,
      fullName: "Someone Else",
      role: "Designer",
    });

    expect(empB.id).not.toBe(empAId);

    const rows = await prisma.employee.findMany({
      where: { employeeRef: "EMP-SHARED-001" },
      select: { id: true, organizationId: true },
      orderBy: { organizationId: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.organizationId))).toEqual(
      new Set([orgAId, orgBId]),
    );
  });

  it("rejects a duplicate employeeRef inside one org as BAD_REQUEST", async () => {
    asUser(h.users.userA);
    await expect(
      employees.create({
        employeeRef: "EMP-SHARED-001",
        email: "someone.else@example.com",
        fullName: "Someone Else",
        role: "Designer",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("addresses a handoff by employeeRef within the caller's org only", async () => {
    // Org B applies a hire for the SAME ref. It must create B's own row, not
    // touch A's — the handoff is keyed by (organizationId, employeeRef).
    asUser(h.users.userB);
    const outcome = await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: "EMP-SHARED-001",
      email: "b.person@example.com",
      fullName: "B Person",
      role: "Engineer",
    });

    expect(outcome.outcome).toBe("created");

    const rowA = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(rowA.status).toBe("CANDIDATE");
    expect(rowA.organizationId).toBe(orgAId);
  });

  // -------------------------------------------------------------------------
  // 2. Handoff guards
  // -------------------------------------------------------------------------

  it("walks the whole chain CANDIDATE → OFFBOARDED one guarded step at a time", async () => {
    asUser(h.users.userA);
    const ref = "EMP-SHARED-001";

    const hired = await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: ref,
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
    });
    expect(hired).toMatchObject({ outcome: "transitioned", to: "OFFERED" });

    expect(
      await employees.applyHandoff({
        event: "employee.onboarding",
        employeeRef: ref,
      }),
    ).toMatchObject({ outcome: "transitioned", to: "ONBOARDING" });

    expect(
      await employees.applyHandoff({
        event: "employee.active",
        employeeRef: ref,
      }),
    ).toMatchObject({ outcome: "transitioned", to: "ACTIVE" });

    expect(
      await employees.applyHandoff({
        event: "employee.offboarding",
        employeeRef: ref,
        exitDate: "2027-01-15",
        exitReason: "Resigned",
      }),
    ).toMatchObject({ outcome: "transitioned", to: "OFFBOARDING" });

    expect(
      await employees.applyHandoff({
        event: "employee.offboarded",
        employeeRef: ref,
      }),
    ).toMatchObject({ outcome: "transitioned", to: "OFFBOARDED" });

    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(row.status).toBe("OFFBOARDED");
    expect(row.exitReason).toBe("Resigned");
    expect(row.activeAt).not.toBeNull();
  });

  it("replays a handoff as already-current instead of transitioning twice", async () => {
    asUser(h.users.userA);
    const ref = "EMP-SHARED-001";

    await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: ref,
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
    });
    const before = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });

    const replay = await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: ref,
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
    });

    expect(replay).toMatchObject({
      outcome: "already-current",
      status: "OFFERED",
    });
    const after = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("completes an exit exactly once — a replayed offboarded is a no-op", async () => {
    asUser(h.users.userA);
    const ref = "EMP-SHARED-001";
    for (const event of [
      "employee.hired",
      "employee.onboarding",
      "employee.active",
    ] as const) {
      await employees.applyHandoff(
        event === "employee.hired"
          ? {
              event,
              employeeRef: ref,
              email: PII.email,
              fullName: PII.fullName,
              role: "Account Executive",
            }
          : { event, employeeRef: ref },
      );
    }
    await employees.applyHandoff({
      event: "employee.offboarding",
      employeeRef: ref,
    });
    await employees.applyHandoff({
      event: "employee.offboarded",
      employeeRef: ref,
    });

    const replay = await employees.applyHandoff({
      event: "employee.offboarded",
      employeeRef: ref,
    });
    expect(replay).toMatchObject({
      outcome: "already-current",
      status: "OFFBOARDED",
    });

    const transitions = await prisma.auditLog.count({
      where: {
        organizationId: orgAId,
        resourceId: empAId,
        action: "employee.status_changed",
      },
    });
    // hired, onboarding, active, offboarding, offboarded — and no sixth.
    expect(transitions).toBe(5);
  });

  it("returns a conflict — never a thrown 500 — for an out-of-sequence handoff", async () => {
    asUser(h.users.userA);

    // CANDIDATE cannot jump straight to ACTIVE.
    const outcome = await employees.applyHandoff({
      event: "employee.active",
      employeeRef: "EMP-SHARED-001",
    });

    expect(outcome).toMatchObject({
      outcome: "conflict",
      from: "CANDIDATE",
      to: "ACTIVE",
    });

    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(row.status).toBe("CANDIDATE");
  });

  it("returns a conflict for an employeeRef the org does not have", async () => {
    asUser(h.users.userA);
    const outcome = await employees.applyHandoff({
      event: "employee.active",
      employeeRef: "EMP-DOES-NOT-EXIST",
    });

    expect(outcome).toMatchObject({
      outcome: "conflict",
      employee: null,
      reason: "unknown employee",
    });
  });

  it("never lets patch move the status", async () => {
    asUser(h.users.userA);
    // `status` is not in `patchInputSchema` at all, so an attempt to smuggle
    // it is stripped at the boundary rather than applied.
    await employees.patch({
      id: empAId,
      role: "Senior Account Executive",
      // biome-ignore lint/suspicious/noExplicitAny: deliberately sending a key the schema does not declare
      ...({ status: "ACTIVE" } as any),
    });

    const row = await prisma.employee.findUniqueOrThrow({
      where: { id: empAId },
    });
    expect(row.status).toBe("CANDIDATE");
    expect(row.role).toBe("Senior Account Executive");
  });

  // -------------------------------------------------------------------------
  // 3. Audit trail + PII containment
  // -------------------------------------------------------------------------

  it("writes an audit row for every mutation, carrying no personal data", async () => {
    asUser(h.users.userA);
    const ref = "EMP-SHARED-001";

    await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: ref,
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
    });
    await employees.applyHandoff({
      event: "employee.onboarding",
      employeeRef: ref,
    });

    const rows = await prisma.auditLog.findMany({
      where: { organizationId: orgAId, resourceType: "employee" },
      orderBy: { createdAt: "asc" },
    });

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.actorType === "SYSTEM")).toBe(true);
    expect(rows.every((row) => row.resourceId === empAId)).toBe(true);

    const serialized = JSON.stringify(rows);
    for (const value of Object.values(PII)) {
      expect(serialized, `audit payload leaked ${value}`).not.toContain(value);
    }
  });

  it("scopes the timeline to the org and returns the chain oldest-first", async () => {
    asUser(h.users.userA);
    const ref = "EMP-SHARED-001";
    await employees.applyHandoff({
      event: "employee.hired",
      employeeRef: ref,
      email: PII.email,
      fullName: PII.fullName,
      role: "Account Executive",
    });
    await employees.applyHandoff({
      event: "employee.onboarding",
      employeeRef: ref,
    });

    const timeline = await employees.timeline({ id: empAId });
    expect(timeline.map((entry) => entry.to)).toEqual([
      "OFFERED",
      "ONBOARDING",
    ]);
    expect(timeline.map((entry) => entry.from)).toEqual([
      "CANDIDATE",
      "OFFERED",
    ]);

    asUser(h.users.userB);
    await expect(employees.timeline({ id: empAId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("logs a conflict with the reference and the statuses, and no personal data", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    asUser(h.users.userA);

    await employees.applyHandoff({
      event: "employee.active",
      employeeRef: "EMP-SHARED-001",
    });

    expect(warn).toHaveBeenCalledWith(
      "employee.handoff.conflict",
      expect.objectContaining({
        employeeRef: "EMP-SHARED-001",
        from: "CANDIDATE",
        to: "ACTIVE",
      }),
    );

    // A conflict must be observable (rule §1: never silent) but must not
    // become a second copy of the employee's personal data in the log stream.
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of Object.values(PII)) {
      expect(logged, `warn log leaked ${value}`).not.toContain(value);
    }
  });

  it("keeps personal data out of the not-found error message", async () => {
    asUser(h.users.userB);
    await employees.getById({ id: empAId }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe("Employee not found.");
      for (const value of Object.values(PII)) {
        expect(message).not.toContain(value);
      }
    });
    expect.hasAssertions();
  });
});
