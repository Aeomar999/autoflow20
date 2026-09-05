import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

vi.mock("node:crypto", () => ({
  randomUUID: () => "uuid-check-1",
}));

describe("BACKGROUND_CHECK execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  it("submits a request and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "backgroundCheck",
          candidateName: "Ada Lovelace",
          candidateEmail: "ada@example.com",
          checkType: "enhanced",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result).toEqual({
      backgroundCheck: {
        candidateName: "Ada Lovelace",
        candidateEmail: "ada@example.com",
        checkType: "enhanced",
        status: "REQUESTED",
        requestId: "uuid-check-1",
      },
    });
  });

  it("defaults the check type to standard and includes notes when provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "backgroundCheck",
          candidateName: "Ada Lovelace",
          candidateEmail: "ada@example.com",
          notes: "Requires enhanced clearance paperwork",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.backgroundCheck).toEqual(
      expect.objectContaining({
        checkType: "standard",
        notes: "Requires enhanced clearance paperwork",
      }),
    );
  });

  it("resolves template fields from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "backgroundCheck",
          candidateName: "{{candidate.name}}",
          candidateEmail: "{{candidate.email}}",
        },
        userId: "user-1",
        context: {
          candidate: { name: "Grace Hopper", email: "grace@example.com" },
        },
        step,
        publish,
      }),
    );

    expect(result.backgroundCheck).toEqual(
      expect.objectContaining({
        candidateName: "Grace Hopper",
        candidateEmail: "grace@example.com",
      }),
    );
  });

  it("omits notes when none are provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: {
          variableName: "backgroundCheck",
          candidateName: "Ada Lovelace",
          candidateEmail: "ada@example.com",
        },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.backgroundCheck).not.toHaveProperty("notes");
  });

  it("rejects a missing variable name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            candidateName: "Ada Lovelace",
            candidateEmail: "ada@example.com",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Background Check node: Variable name is missing"),
    );
  });

  it("rejects a missing candidate name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "backgroundCheck",
            candidateEmail: "ada@example.com",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Background Check node: Candidate name is missing"),
    );
  });

  it("rejects a candidate name that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "backgroundCheck",
            candidateName: "{{candidate.name}}",
            candidateEmail: "ada@example.com",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Background Check node: the candidate name expression resolved to nothing.",
      ),
    );
  });

  it("rejects a missing candidate email", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "backgroundCheck",
            candidateName: "Ada Lovelace",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Background Check node: Candidate email is missing",
      ),
    );
  });

  it("rejects a candidate email that resolves to nothing", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: {
            variableName: "backgroundCheck",
            candidateName: "Ada Lovelace",
            candidateEmail: "{{candidate.email}}",
          },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError(
        "Background Check node: the candidate email expression resolved to nothing.",
      ),
    );
  });
});
