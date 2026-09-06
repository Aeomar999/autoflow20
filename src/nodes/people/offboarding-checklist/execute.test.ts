import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools, WorkflowContext } from "@/nodes/types";
import type { OffboardingChecklistData } from "./execute";
import { execute } from "./execute";

/**
 * `execute` returns `WorkflowContext` (`Record<string, unknown>`), so a field
 * read off the stored result is `unknown`. Narrowed once here rather than cast
 * at each assertion, so the assertions stay readable and the shape is stated
 * in one place (AF-M11-15).
 */
const offboardingIn = (result: WorkflowContext) =>
  result.offboarding as {
    checklist: {
      phase: string;
      role: string;
      items: {
        key: string;
        label: string;
        owner?: string;
        dueOffsetDays: number;
        completed: boolean;
      }[];
      generatedAt: string;
    };
  };

describe("OFFBOARDING_CHECKLIST execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("builds an offboarding checklist and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarding",
          roleTitle: "Staff Engineer",
          items: [
            { key: "access", label: "Revoke system access", dueOffsetDays: 0 },
            {
              key: "hardware",
              label: "Arrange hardware return",
              owner: "IT",
              dueOffsetDays: 2,
            },
            { key: "payroll", label: "Final payroll payout" },
          ],
        } satisfies OffboardingChecklistData,
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offboarding).toEqual({
      checklist: {
        phase: "OFFBOARDING",
        role: "Staff Engineer",
        items: [
          {
            key: "access",
            label: "Revoke system access",
            dueOffsetDays: 0,
            completed: false,
          },
          {
            key: "hardware",
            label: "Arrange hardware return",
            owner: "IT",
            dueOffsetDays: 2,
            completed: false,
          },
          {
            key: "payroll",
            label: "Final payroll payout",
            dueOffsetDays: 0,
            completed: false,
          },
        ],
        generatedAt: expect.any(String),
      },
    });
  });

  it("defaults to an empty item list when none are configured", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "offboarding" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(offboardingIn(result).checklist).toEqual(
      expect.objectContaining({
        phase: "OFFBOARDING",
        role: "",
        items: [],
      }),
    );
  });

  it("resolves the role title from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "offboarding",
          roleTitle: "{{employee.role}}",
          items: [{ key: "access", label: "Revoke system access" }],
        } satisfies OffboardingChecklistData,
        userId: "user-1",
        context: { employee: { role: "Designer" } },
        step,
        publish,
      }),
    );

    expect(offboardingIn(result).checklist.role).toBe("Designer");
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { items: [{ key: "access", label: "Revoke system access" }] },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Offboarding Checklist node: Variable name is missing",
      ),
    );
  });
});
