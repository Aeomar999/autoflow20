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
  from: "OFFERED",
  to: "ONBOARDING",
} as unknown as HandoffOutcome;

const conflictOutcome = {
  outcome: "conflict",
  employee: null,
  from: "ACTIVE",
  to: "ONBOARDING",
  reason: "Expected OFFERED/ONBOARDING, was ACTIVE",
} as unknown as HandoffOutcome;

describe("EMPLOYEE_ONBOARDING execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    handoffMock.mockReset();
  });

  it("transitions the hire into onboarding and stores the outcome", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "onboarding",
          employeeRef: "EMP-ADA-009",
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
        event: "employee.onboarding",
        employeeRef: "EMP-ADA-009",
      }),
    );
    expect(result).toEqual({ onboarding: transitionedOutcome });
  });

  it("resolves template fields from context", async () => {
    handoffMock.mockResolvedValue(transitionedOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "onboarding",
          employeeRef: "{{candidate.employeeRef}}",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {
          candidate: { employeeRef: "EMP-GRA-002" },
        },
        step,
        publish,
      }),
    );

    expect(handoffMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        employeeRef: "EMP-GRA-002",
      }),
    );
    expect(result.onboarding).toEqual(transitionedOutcome);
  });

  it("stores a conflict outcome and completes the run without throwing", async () => {
    handoffMock.mockResolvedValue(conflictOutcome);

    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "onboarding",
          employeeRef: "EMP-ADA-009",
        },
        userId: "user-1",
        organizationId: "org-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.onboarding).toEqual(conflictOutcome);
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
      new NonRetriableError("Start Onboarding node: Variable name is missing"),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects a missing employee reference", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "onboarding" },
          userId: "user-1",
          organizationId: "org-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Start Onboarding node: the employee reference expression resolved to nothing.",
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
            variableName: "onboarding",
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
        "Start Onboarding node: the run has no organizationId; it cannot scope the employee write.",
      ),
    );
    expect(handoffMock).not.toHaveBeenCalled();
  });

  it("rejects onboarding input that fails the shared schema", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "onboarding",
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
      message: expect.stringContaining("onboarding input is invalid"),
    });
    expect(handoffMock).not.toHaveBeenCalled();
  });
});
