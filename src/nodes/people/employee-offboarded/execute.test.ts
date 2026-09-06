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

const transitionedOutcome = {
  outcome: "transitioned",
  employee: { id: "emp-1" },
  from: "OFFBOARDING",
  to: "OFFBOARDED",
} as unknown as HandoffOutcome;

const alreadyCurrentOutcome = {
  outcome: "already-current",
  employee: { id: "emp-1" },
  status: "OFFBOARDED",
} as unknown as HandoffOutcome;

const conflictOutcome = {
  outcome: "conflict",
  employee: null,
  from: "ACTIVE",
  to: "OFFBOARDED",
  reason: "Expected OFFBOARDING/OFFBOARDED, was ACTIVE",
} as unknown as HandoffOutcome;

describe("EMPLOYEE_OFFBOARDED execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    handoffMock.mockReset();
  });

  it("moves the employee to OFFBOARDED and stores the outcome", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarded",
          employeeRef: "EMP-ADA-009",
          exitDate: "2026-12-31",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledTimes(1);
    expect(handoffMock).toHaveBeenCalledWith("org-1", {
      event: "employee.offboarded",
      employeeRef: "EMP-ADA-009",
      exitDate: "2026-12-31",
    });
    expect(result).toEqual({ offboarded: transitionedOutcome });
  });

  it("is a no-op on replay — the end state completes exactly once", async () => {
    handoffMock.mockResolvedValue(alreadyCurrentOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "offboarded", employeeRef: "EMP-ADA-009" },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offboarded).toEqual(alreadyCurrentOutcome);
  });

  it("resolves template fields from context", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarded",
          employeeRef: "{{employee.employeeRef}}",
          exitDate: "{{offboarding.employee.exitDate}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {
          employee: { employeeRef: "EMP-GRA-002" },
          offboarding: { employee: { exitDate: "2027-01-15" } },
        },
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith("org-1", {
      event: "employee.offboarded",
      employeeRef: "EMP-GRA-002",
      exitDate: "2027-01-15",
    });
  });

  it("treats an exit date that resolves to nothing as absent", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarded",
          employeeRef: "EMP-ADA-009",
          exitDate: "{{request.lastDay}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(handoffMock.mock.calls[0]?.[1]).not.toHaveProperty("exitDate");
  });

  it("stores a conflict outcome and completes the run without throwing", async () => {
    handoffMock.mockResolvedValue(conflictOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "offboarded", employeeRef: "EMP-ADA-009" },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offboarded).toEqual(conflictOutcome);
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { employeeRef: "EMP-ADA-009" },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Complete Offboarding node: Variable name is missing",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a missing employee reference", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "offboarded" },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Complete Offboarding node: the employee reference expression resolved to nothing.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a run without an organizationId", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "offboarded", employeeRef: "EMP-ADA-009" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Complete Offboarding node: the run has no organizationId; it cannot scope the employee write.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects offboarded input that fails the shared schema", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "offboarded",
            employeeRef: "EMP-ADA-009",
            exitDate: "31/12/2026",
          },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("offboarded input is invalid"),
    });
    expect(handoffMock).not.toHaveBeenCalled();
  });
});
