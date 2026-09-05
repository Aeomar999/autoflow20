import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("EXIT_INTERVIEW execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("schedules an exit interview and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "exitInterview",
          employeeName: "Ada Lovelace",
          departureDate: "2026-09-30",
          interviewer: "People Team",
          format: "in_person",
          focusAreas: [
            { area: "Why leaving" },
            { area: "Compensation" },
            { area: "Culture" },
          ],
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      exitInterview: {
        employeeName: "Ada Lovelace",
        departureDate: "2026-09-30",
        interviewer: "People Team",
        format: "in_person",
        focusAreas: ["Why leaving", "Compensation", "Culture"],
        status: "SCHEDULED",
      },
    });
  });

  it("defaults the format to video and omits empty optional fields", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { variableName: "exitInterview", employeeName: "Ada Lovelace" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.exitInterview).toEqual({
      employeeName: "Ada Lovelace",
      format: "video",
      focusAreas: [],
      status: "SCHEDULED",
    });
  });

  it("resolves fields from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "exitInterview",
          employeeName: "{{employee.name}}",
          departureDate: "{{employee.lastDay}}",
          interviewer: "{{hr.rep}}",
        },
        userId: "user-1",
        context: {
          employee: { name: "Grace Hopper", lastDay: "2026-09-30" },
          hr: { rep: "Sam" },
        },
        step,
        publish,
      }),
    );

    expect(result.exitInterview).toEqual(
      expect.objectContaining({
        employeeName: "Grace Hopper",
        departureDate: "2026-09-30",
        interviewer: "Sam",
      }),
    );
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
      new NonRetriableError("Exit Interview node: Variable name is missing"),
    );
  });

  it("rejects a missing employee name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "exitInterview" },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Exit Interview node: Employee name is missing"),
    );
  });

  it("rejects an employee name that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "exitInterview",
            employeeName: "{{employee.name}}",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Exit Interview node: the employee name expression resolved to nothing.",
      ),
    );
  });
});
