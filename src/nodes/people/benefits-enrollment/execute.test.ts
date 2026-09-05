import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("BENEFITS_ENROLLMENT execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("submits an enrollment and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "benefits",
          employeeName: "Ada Lovelace",
          plan: "dental",
          dependentsCount: 2,
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      benefits: {
        employeeName: "Ada Lovelace",
        plan: "dental",
        dependentsCount: 2,
        status: "SUBMITTED",
      },
    });
  });

  it("defaults to the medical plan and a zero dependents count", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "benefits", employeeName: "Ada Lovelace" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.benefits).toEqual(
      expect.objectContaining({ plan: "medical", dependentsCount: 0 }),
    );
  });

  it("includes notes when provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "benefits",
          employeeName: "Ada Lovelace",
          notes: "Spouse added on 1 June",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.benefits).toEqual(
      expect.objectContaining({ notes: "Spouse added on 1 June" }),
    );
  });

  it("omits notes when none are provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "benefits", employeeName: "Ada Lovelace" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.benefits).not.toHaveProperty("notes");
  });

  it("resolves the employee name from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "benefits", employeeName: "{{employee.name}}" },
        userId: "user-1",
        context: { employee: { name: "Grace Hopper" } },
        step,
        publish,
      }),
    );

    expect(result.benefits.employeeName).toBe("Grace Hopper");
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { employeeName: "Ada Lovelace" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Benefits Enrollment node: Variable name is missing",
      ),
    );
  });

  it("rejects a missing employee name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "benefits" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Benefits Enrollment node: Employee name is missing",
      ),
    );
  });

  it("rejects an employee name that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "benefits", employeeName: "{{employee.name}}" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Benefits Enrollment node: the employee name expression resolved to nothing.",
      ),
    );
  });
});
