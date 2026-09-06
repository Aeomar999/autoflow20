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
  from: "ONBOARDING",
  to: "ACTIVE",
} as unknown as HandoffOutcome;

const conflictOutcome = {
  outcome: "conflict",
  employee: null,
  from: "OFFBOARDING",
  to: "ACTIVE",
  reason: "Expected OFFERED/ONBOARDING/ACTIVE, was OFFBOARDING",
} as unknown as HandoffOutcome;

describe("EMPLOYEE_ACTIVE execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    handoffMock.mockReset();
  });

  it("moves the employee to ACTIVE and stores the outcome", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "active",
          employeeRef: "EMP-ADA-009",
          activeAt: "2026-11-01",
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
        event: "employee.active",
        employeeRef: "EMP-ADA-009",
        activeAt: "2026-11-01",
      }),
    );
    expect(result).toEqual({ active: transitionedOutcome });
  });

  it("omits activeAt from the payload when not configured", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "active",
          employeeRef: "EMP-ADA-009",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    const input = handoffMock.mock.calls[0]?.[1];
    expect(input).toMatchObject({
      event: "employee.active",
      employeeRef: "EMP-ADA-009",
    });
    expect(input).not.toHaveProperty("activeAt");
  });

  it("resolves template fields from context", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "active",
          employeeRef: "{{candidate.employeeRef}}",
          activeAt: "{{onboarding.completeDate}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {
          candidate: { employeeRef: "EMP-GRA-002" },
          onboarding: { completeDate: "2026-12-15" },
        },
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        employeeRef: "EMP-GRA-002",
        activeAt: "2026-12-15",
      }),
    );
    expect(result.active).toEqual(transitionedOutcome);
  });

  it("stores a conflict outcome and completes the run without throwing", async () => {
    handoffMock.mockResolvedValue(conflictOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "active",
          employeeRef: "EMP-ADA-009",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.active).toEqual(conflictOutcome);
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
        "Mark Employee Active node: Variable name is missing",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a missing employee reference", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "active" },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Mark Employee Active node: the employee reference expression resolved to nothing.",
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
            variableName: "active",
            employeeRef: "EMP-ADA-009",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Mark Employee Active node: the run has no organizationId; it cannot scope the employee write.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects active input that fails the shared schema", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "active",
            employeeRef: "a".repeat(201),
          },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("active input is invalid"),
    });
    expect(handoffMock).not.toHaveBeenCalled();
  });
});
