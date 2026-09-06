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
  from: "ACTIVE",
  to: "OFFBOARDING",
} as unknown as HandoffOutcome;

const conflictOutcome = {
  outcome: "conflict",
  employee: null,
  from: "ONBOARDING",
  to: "OFFBOARDING",
  reason: "Expected ACTIVE/OFFBOARDING, was ONBOARDING",
} as unknown as HandoffOutcome;

describe("EMPLOYEE_OFFBOARDING execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    handoffMock.mockReset();
  });

  it("moves the employee to OFFBOARDING and stores the outcome", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarding",
          employeeRef: "EMP-ADA-009",
          exitDate: "2026-12-31",
          exitReason: "Resigned to relocate",
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
      event: "employee.offboarding",
      employeeRef: "EMP-ADA-009",
      exitDate: "2026-12-31",
      exitReason: "Resigned to relocate",
    });
    expect(result).toEqual({ offboarding: transitionedOutcome });
  });

  it("resolves template fields from context", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarding",
          employeeRef: "{{employee.employeeRef}}",
          exitDate: "{{request.lastDay}}",
          exitReason: "{{request.reason}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {
          employee: { employeeRef: "EMP-GRA-002" },
          request: { lastDay: "2027-01-15", reason: "End of contract" },
        },
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        employeeRef: "EMP-GRA-002",
        exitDate: "2027-01-15",
        exitReason: "End of contract",
      }),
    );
  });

  it("omits optional fields that are not configured", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "offboarding", employeeRef: "EMP-ADA-009" },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    const input = handoffMock.mock.calls[0]?.[1];
    expect(input).not.toHaveProperty("exitDate");
    expect(input).not.toHaveProperty("exitReason");
  });

  it("treats an optional field that resolves to nothing as absent", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarding",
          employeeRef: "EMP-ADA-009",
          exitDate: "{{request.lastDay}}",
          exitReason: "{{request.reason}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    const input = handoffMock.mock.calls[0]?.[1];
    expect(input).not.toHaveProperty("exitDate");
    expect(input).not.toHaveProperty("exitReason");
  });

  it("stores a conflict outcome and completes the run without throwing", async () => {
    handoffMock.mockResolvedValue(conflictOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "offboarding", employeeRef: "EMP-ADA-009" },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offboarding).toEqual(conflictOutcome);
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
      new NonRetriableError("Start Offboarding node: Variable name is missing"),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a missing employee reference", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "offboarding" },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Start Offboarding node: the employee reference expression resolved to nothing.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a run without an organizationId", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "offboarding", employeeRef: "EMP-ADA-009" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Start Offboarding node: the run has no organizationId; it cannot scope the employee write.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects offboarding input that fails the shared schema", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "offboarding",
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
      message: expect.stringContaining("offboarding input is invalid"),
    });
    expect(handoffMock).not.toHaveBeenCalled();
  });
});
