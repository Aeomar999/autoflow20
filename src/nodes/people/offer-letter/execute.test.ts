import { NonRetriableError } from "inngest";
import { describe, expect, it, vi } from "vitest";
import { withResolve } from "@/nodes/shared/test-params";
import type { StepTools } from "@/nodes/types";
import { execute } from "./execute";

describe("OFFER_LETTER execute", () => {
  const step = {
    run: vi.fn((_name: string, fn: () => unknown) => fn()),
  } as unknown as StepTools;
  const publish = vi.fn().mockResolvedValue(undefined);

  const data = {
    variableName: "offer",
    companyName: "Acme",
    roleTitle: "Staff Engineer",
    candidateName: "Ada Lovelace",
    startDate: "2026-07-01",
    workLocation: "London",
    compensationText: "£150,000 base salary",
    employmentType: "full_time",
  };

  it("drafts a letter and stores it under the variable name", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data,
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offer).toEqual(
      expect.objectContaining({
        candidateName: "Ada Lovelace",
        roleTitle: "Staff Engineer",
        companyName: "Acme",
        startDate: "2026-07-01",
        workLocation: "London",
        employmentType: "full_time",
        compensationText: "£150,000 base salary",
        generatedAt: expect.any(String),
      }),
    );
    expect(result.offer.letter).toContain(
      "We are pleased to offer you the position of Staff Engineer at Acme, starting on 2026-07-01",
    );
    expect(result.offer.letter).toContain("£150,000 base salary");
    expect(result.offer.letter).toContain("not yet approved for signature");
  });

  it("resolves template fields from context", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { ...data, candidateName: "{{candidate.name}}" },
        userId: "user-1",
        context: { candidate: { name: "Grace Hopper" } },
        step,
        publish,
      }),
    );

    expect(result.offer).toEqual(
      expect.objectContaining({
        candidateName: "Grace Hopper",
        roleTitle: "Staff Engineer",
      }),
    );
    expect(result.offer.letter).toContain("Dear Grace Hopper,");
  });

  it("appends extra terms when provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { ...data, extraTerms: "Sign-on bonus of £10,000" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offer.letter).toContain("Sign-on bonus of £10,000");
  });

  it("omits the extra-terms section when none are provided", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data,
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offer.letter).not.toContain("Additional terms:");
  });

  it("uses the contract employment label", async () => {
    const result = await execute(
      withResolve({
        nodeId: "node-1",
        data: { ...data, employmentType: "contract" },
        userId: "user-1",
        context: {},
        step,
        publish,
      }),
    );

    expect(result.offer.letter).toContain("contract engagement");
  });

  it("rejects a missing variable name", async () => {
    const { variableName: _variableName, ...withoutVariableName } = data;
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: withoutVariableName,
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Offer Letter node: Variable name is missing"),
    );
  });

  it("rejects a missing company name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { ...data, companyName: undefined },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Offer Letter node: Company name is missing"),
    );
  });

  it("rejects a missing role title", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { ...data, roleTitle: undefined },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Offer Letter node: Role title is missing"),
    );
  });

  it("rejects a missing candidate name", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { ...data, candidateName: undefined },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Offer Letter node: Candidate name is missing"),
    );
  });

  it("rejects a missing compensation", async () => {
    await expect(
      execute(
        withResolve({
          nodeId: "node-1",
          data: { ...data, compensationText: undefined },
          userId: "user-1",
          context: {},
          step,
          publish,
        }),
      ),
    ).rejects.toEqual(
      new NonRetriableError("Offer Letter node: Compensation is missing"),
    );
  });
});
