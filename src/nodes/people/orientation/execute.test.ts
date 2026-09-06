import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools, WorkflowContext } from "@/nodes/types";
import { execute } from "./execute";

/**
 * `execute` returns `WorkflowContext` (`Record<string, unknown>`), so a field
 * read off the stored result is `unknown`. Narrowed once here rather than cast
 * at each assertion, so the assertions stay readable and the shape is stated
 * in one place (AF-M11-15).
 */
const orientationIn = (result: WorkflowContext) =>
  result.orientation as {
    orientation: {
      sessionName: string;
      startDate?: string;
      locationOrMode?: string;
      durationMinutes: number;
      agenda: { time?: string; topic: string; owner?: string }[];
    };
  };

describe("ORIENTATION execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("builds an orientation session and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "orientation",
          sessionName: "New Hire Orientation",
          startDate: "2026-07-06",
          locationOrMode: "London office",
          durationMinutes: 120,
          agendaItems: [
            {
              time: "09:30",
              topic: "Welcome & introductions",
              owner: "People Team",
            },
            { time: "10:15", topic: "IT & security onboarding" },
          ],
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.orientation).toEqual({
      orientation: {
        sessionName: "New Hire Orientation",
        startDate: "2026-07-06",
        locationOrMode: "London office",
        durationMinutes: 120,
        agenda: [
          {
            time: "09:30",
            topic: "Welcome & introductions",
            owner: "People Team",
          },
          { time: "10:15", topic: "IT & security onboarding" },
        ],
      },
    });
  });

  it("defaults the duration to 60 minutes and omits empty optional fields", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "orientation", sessionName: "Orientation" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.orientation).toEqual({
      orientation: {
        sessionName: "Orientation",
        durationMinutes: 60,
        agenda: [],
      },
    });
  });

  it("resolves logistics from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "orientation",
          sessionName: "Welcome {{employee.name}}",
          startDate: "{{employee.startDate}}",
          locationOrMode: "{{employee.location}}",
        },
        userId: "user-1",
        context: {
          employee: {
            name: "Grace",
            startDate: "2026-07-06",
            location: "Remote",
          },
        },
        step,
        publish,
      }),
    );

    expect(orientationIn(result).orientation).toEqual(
      expect.objectContaining({
        sessionName: "Welcome Grace",
        startDate: "2026-07-06",
        locationOrMode: "Remote",
      }),
    );
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { sessionName: "Orientation" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Orientation node: Variable name is missing"),
    );
  });
});
