import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools, WorkflowContext } from "@/nodes/types";
import type { OnboardingChecklistData } from "./execute";
import { execute } from "./execute";

/**
 * `execute` returns `WorkflowContext` (`Record<string, unknown>`), so a field
 * read off the stored result is `unknown`. Narrowed once here rather than cast
 * at each assertion, so the assertions stay readable and the shape is stated
 * in one place (AF-M11-15).
 */
const onboardingIn = (result: WorkflowContext) =>
  result.onboarding as {
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

describe("ONBOARDING_CHECKLIST execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("builds an onboarding checklist and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "onboarding",
          roleTitle: "Staff Engineer",
          items: [
            { key: "laptop", label: "Provision laptop", dueOffsetDays: 0 },
            {
              key: "badge",
              label: "Order access badge",
              owner: "SecOps",
              dueOffsetDays: 3,
            },
            { key: "buddy", label: "Assign onboarding buddy" },
          ],
        } satisfies OnboardingChecklistData,
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.onboarding).toEqual({
      checklist: {
        phase: "ONBOARDING",
        role: "Staff Engineer",
        items: [
          {
            key: "laptop",
            label: "Provision laptop",
            dueOffsetDays: 0,
            completed: false,
          },
          {
            key: "badge",
            label: "Order access badge",
            owner: "SecOps",
            dueOffsetDays: 3,
            completed: false,
          },
          {
            key: "buddy",
            label: "Assign onboarding buddy",
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
        data: { variableName: "onboarding" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(onboardingIn(result).checklist).toEqual(
      expect.objectContaining({
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
          variableName: "onboarding",
          roleTitle: "{{employee.role}}",
          items: [{ key: "laptop", label: "Provision laptop" }],
        } satisfies OnboardingChecklistData,
        userId: "user-1",
        context: { employee: { role: "Designer" } },
        step,
        publish,
      }),
    );

    expect(onboardingIn(result).checklist.role).toBe("Designer");
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            roleTitle: "Staff Engineer",
            items: [{ key: "laptop", label: "Provision laptop" }],
          } satisfies OnboardingChecklistData,
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Onboarding Checklist node: Variable name is missing",
      ),
    );
  });
});
