import { describe, expect, it } from "vitest";

import { EMPLOYEE_STATUSES } from "./employee";
import {
  buildStatusChain,
  isEmployeeStatus,
  statusChainPosition,
} from "./status-chain";

describe("statusChainPosition", () => {
  it("returns the index of each known status", () => {
    for (const [index, status] of EMPLOYEE_STATUSES.entries()) {
      expect(statusChainPosition(status)).toBe(index);
    }
  });

  it("returns -1 for a status this build does not know", () => {
    // `Employee.status` is an open-set String column, so this is reachable.
    expect(statusChainPosition("REJECTED")).toBe(-1);
    expect(statusChainPosition("")).toBe(-1);
  });
});

describe("isEmployeeStatus", () => {
  it("accepts every status in the contract", () => {
    for (const status of EMPLOYEE_STATUSES) {
      expect(isEmployeeStatus(status)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isEmployeeStatus("REJECTED")).toBe(false);
    expect(isEmployeeStatus("active")).toBe(false);
  });
});

describe("buildStatusChain", () => {
  it("covers the whole chain regardless of position", () => {
    const chain = buildStatusChain("ONBOARDING");
    expect(chain.map((step) => step.status)).toEqual([...EMPLOYEE_STATUSES]);
  });

  it("marks exactly one step current, with the rest split past/upcoming", () => {
    const chain = buildStatusChain("ONBOARDING");
    expect(chain.filter((step) => step.state === "current")).toEqual([
      { status: "ONBOARDING", state: "current" },
    ]);
    expect(
      chain.filter((step) => step.state === "past").map((s) => s.status),
    ).toEqual(["CANDIDATE", "OFFERED"]);
    expect(
      chain.filter((step) => step.state === "upcoming").map((s) => s.status),
    ).toEqual(["ACTIVE", "OFFBOARDING", "OFFBOARDED"]);
  });

  it("marks nothing past at the head of the chain", () => {
    const chain = buildStatusChain("CANDIDATE");
    expect(chain.some((step) => step.state === "past")).toBe(false);
    expect(chain[0]?.state).toBe("current");
  });

  it("marks nothing upcoming at the end state", () => {
    const chain = buildStatusChain("OFFBOARDED");
    expect(chain.some((step) => step.state === "upcoming")).toBe(false);
    expect(chain.at(-1)?.state).toBe("current");
  });

  it("leaves every step upcoming for an unknown status rather than guessing", () => {
    const chain = buildStatusChain("REJECTED");
    expect(chain.every((step) => step.state === "upcoming")).toBe(true);
  });
});
