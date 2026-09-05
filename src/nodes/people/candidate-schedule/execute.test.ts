import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("CANDIDATE_SCHEDULE execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("resolves templates and stores the interview under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "interview",
          candidateName: "{{candidate.name}}",
          candidateEmail: "{{candidate.email}}",
          interviewType: "technical",
          bookingUrlTemplate: "{{booking.url}}",
        },
        userId: "user-1",
        context: {
          candidate: { name: "Ada", email: "ada@example.com" },
          booking: { url: "https://cal.example/adajuneslot" },
        },
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      candidate: { name: "Ada", email: "ada@example.com" },
      booking: { url: "https://cal.example/adajuneslot" },
      interview: {
        candidateName: "Ada",
        candidateEmail: "ada@example.com",
        interviewType: "technical",
        bookingUrl: "https://cal.example/adajuneslot",
      },
    });
  });

  it("defaults the interview type to recruiter", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "interview",
          candidateEmail: "ada@example.com",
          bookingUrlTemplate: "https://cal.example/general",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.interview).toEqual(
      expect.objectContaining({ interviewType: "recruiter" }),
    );
  });

  it("leaves the candidate name empty when it is not configured", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "interview",
          candidateEmail: "ada@example.com",
          bookingUrlTemplate: "https://cal.example/general",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.interview).toEqual(
      expect.objectContaining({ candidateName: "" }),
    );
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            candidateEmail: "ada@example.com",
            bookingUrlTemplate: "https://cal.example/general",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Schedule node: Variable name is missing",
      ),
    );
  });

  it("rejects a blank candidate email", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { variableName: "interview", candidateEmail: "   " },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Schedule node: Candidate email is missing",
      ),
    );
  });

  it("rejects an email expression that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "interview",
            candidateEmail: "{{candidate.email}}",
            bookingUrlTemplate: "https://cal.example/general",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Candidate Schedule node: the candidate email expression resolved to nothing.",
      ),
    );
  });

  it("rejects a missing booking URL template", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "interview",
            candidateEmail: "ada@example.com",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Candidate Schedule node: Booking URL is missing"),
    );
  });
});
