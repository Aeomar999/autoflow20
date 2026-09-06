import { NonRetriableError } from "inngest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffOutcome } from "@/features/employees/server/handoff";
import { applyEmployeeHandoff } from "@/features/employees/server/handoff";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

vi.mock("@/features/employees/server/handoff", () => ({
  applyEmployeeHandoff: vi.fn(),
}));

const handoffMock = vi.mocked(applyEmployeeHandoff);

const createdOutcome = {
  outcome: "created",
  employee: { id: "emp-1" },
  status: "OFFERED",
} as unknown as HandoffOutcome;

const conflictOutcome = {
  outcome: "conflict",
  employee: null,
  from: "ONBOARDING",
  to: "OFFERED",
  reason: "Expected CANDIDATE/OFFERED, was ONBOARDING",
} as unknown as HandoffOutcome;

describe("EMPLOYEE_HIRED execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    handoffMock.mockReset();
  });

  it("creates the hire and stores the outcome under the variable name", async () => {
    handoffMock.mockResolvedValue(createdOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "hire",
          employeeRef: "EMP-ADA-009",
          email: "ada@example.com",
          fullName: "Ada Boateng",
          role: "Account Executive",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledTimes(1);
    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        event: "employee.hired",
        employeeRef: "EMP-ADA-009",
        email: "ada@example.com",
        fullName: "Ada Boateng",
        role: "Account Executive",
      }),
    );
    expect(result).toEqual({ hire: createdOutcome });
  });

  it("passes optional fields through when provided", async () => {
    handoffMock.mockResolvedValue(createdOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "hire",
          employeeRef: "EMP-ADA-009",
          email: "ada@example.com",
          fullName: "Ada Boateng",
          role: "Account Executive",
          department: "Sales",
          managerEmail: "boss@example.com",
          personalEmail: "ada.personal@example.com",
          startDate: "2026-11-01",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        department: "Sales",
        managerEmail: "boss@example.com",
        personalEmail: "ada.personal@example.com",
        startDate: "2026-11-01",
      }),
    );
  });

  it("treats optional fields that resolve to nothing as absent", async () => {
    // AF-M11-14 regression. The W1 template authors `department`,
    // `managerEmail` and `startDate` as expressions; an ATS payload that omits
    // them resolved to "" and failed the email/date schemas, killing the hire.
    handoffMock.mockResolvedValue(createdOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "hire",
          employeeRef: "EMP-ADA-009",
          email: "ada@example.com",
          fullName: "Ada Boateng",
          role: "Account Executive",
          department: "{{department}}",
          managerEmail: "{{managerEmail}}",
          personalEmail: "{{personalEmail}}",
          startDate: "{{startDate}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith("org-1", {
      event: "employee.hired",
      employeeRef: "EMP-ADA-009",
      email: "ada@example.com",
      fullName: "Ada Boateng",
      role: "Account Executive",
    });
  });

  it("resolves template fields from context", async () => {
    handoffMock.mockResolvedValue(createdOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "hire",
          employeeRef: "{{candidate.employeeRef}}",
          email: "{{candidate.email}}",
          fullName: "{{candidate.name}}",
          role: "{{offer.roleTitle}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {
          candidate: {
            employeeRef: "EMP-GRA-002",
            email: "grace@example.com",
            name: "Grace Hopper",
          },
          offer: { roleTitle: "Engineer" },
        },
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        employeeRef: "EMP-GRA-002",
        email: "grace@example.com",
        fullName: "Grace Hopper",
        role: "Engineer",
      }),
    );
    expect(result.hire).toEqual(createdOutcome);
  });

  it("stores a conflict outcome and completes the run without throwing", async () => {
    handoffMock.mockResolvedValue(conflictOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "hire",
          employeeRef: "EMP-ADA-009",
          email: "ada@example.com",
          fullName: "Ada Boateng",
          role: "Account Executive",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.hire).toEqual(conflictOutcome);
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            employeeRef: "EMP-ADA-009",
            email: "ada@example.com",
            fullName: "Ada Boateng",
            role: "Account Executive",
          },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Record New Hire node: Variable name is missing"),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a missing employee reference", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "hire",
            email: "ada@example.com",
            fullName: "Ada Boateng",
            role: "Account Executive",
          },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Record New Hire node: the employee reference expression resolved to nothing.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a run without an organizationId", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "hire",
            employeeRef: "EMP-ADA-009",
            email: "ada@example.com",
            fullName: "Ada Boateng",
            role: "Account Executive",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Record New Hire node: the run has no organizationId; it cannot scope the employee write.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects hire input that fails the shared schema", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "hire",
            employeeRef: "EMP-ADA-009",
            email: "not-an-email",
            fullName: "Ada Boateng",
            role: "Account Executive",
          },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("hire input is invalid"),
    });
    expect(handoffMock).not.toHaveBeenCalled();
  });
});
