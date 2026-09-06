import { beforeEach, describe, expect, it, vi } from "vitest";

import { listBambooHrEmployees } from "@/features/hris/server/bamboohr-client";

import { polling } from "./polling";

vi.mock("@/features/hris/server/bamboohr-client", () => ({
  listBambooHrEmployees: vi.fn(),
}));

const listMock = vi.mocked(listBambooHrEmployees);

const employee = (over: Partial<Record<string, string | null>> = {}) => ({
  id: "101",
  displayName: "Ada Boateng",
  firstName: "Ada",
  lastName: "Boateng",
  workEmail: "ada@example.com",
  jobTitle: "Account Executive",
  department: "Sales",
  supervisorEmail: "grace@example.com",
  hireDate: "2026-11-01",
  ...over,
});

const ctx = (over: Partial<Parameters<typeof polling.poll>[0]> = {}) =>
  ({
    config: {},
    credentials: { credentialId: { apiKey: "k", companyDomain: "acme" } },
    cursor: undefined,
    isFirstPoll: false,
    limit: 50,
    ...over,
  }) as Parameters<typeof polling.poll>[0];

describe("BAMBOOHR_TRIGGER polling", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it("maps a directory entry into an EMPLOYEE_HIRED-shaped item", async () => {
    listMock.mockResolvedValue([employee()]);

    const result = await polling.poll(ctx());

    expect(result.items).toEqual([
      {
        // Identity is the HRIS id, so a person is dispatched once and an edit
        // does not re-fire the chain.
        id: "101",
        data: {
          employee: {
            employeeRef: "101",
            email: "ada@example.com",
            fullName: "Ada Boateng",
            role: "Account Executive",
            department: "Sales",
            managerEmail: "grace@example.com",
            startDate: "2026-11-01",
          },
          source: "bamboohr",
        },
      },
    ]);
  });

  it("falls back to first + last name when the directory has no display name", async () => {
    listMock.mockResolvedValue([employee({ displayName: null })]);

    const result = await polling.poll(ctx());

    expect(
      (result.items[0]?.data as { employee: { fullName: string } }).employee
        .fullName,
    ).toBe("Ada Boateng");
  });

  it("drops an employee with no work email rather than dispatching a doomed run", async () => {
    // `employeeHiredSchema` requires an email; a run that is certain to fail at
    // its second node is worse than one that is never started.
    listMock.mockResolvedValue([employee({ workEmail: null })]);

    const result = await polling.poll(ctx());

    expect(result.items).toEqual([]);
  });

  it("filters to the configured department, case-insensitively", async () => {
    listMock.mockResolvedValue([
      employee({ id: "101", department: "Sales" }),
      employee({ id: "102", department: "Design" }),
    ]);

    const result = await polling.poll(
      ctx({ config: { department: " sales " } }),
    );

    expect(result.items.map((item) => item.id)).toEqual(["101"]);
  });

  it("dispatches every department when no filter is configured", async () => {
    listMock.mockResolvedValue([
      employee({ id: "101", department: "Sales" }),
      employee({ id: "102", department: "Design" }),
    ]);

    const result = await polling.poll(ctx());

    expect(result.items.map((item) => item.id)).toEqual(["101", "102"]);
  });

  it("never returns more than the framework's limit", async () => {
    listMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) =>
        employee({ id: String(index), workEmail: `p${index}@example.com` }),
      ),
    );

    const result = await polling.poll(ctx({ limit: 3 }));

    expect(result.items).toHaveLength(3);
  });

  it("records a diagnosable cursor", async () => {
    listMock.mockResolvedValue([employee()]);

    const result = await polling.poll(ctx());

    expect(result.cursor).toMatchObject({ directorySize: 1 });
    expect(
      typeof (result.cursor as { lastPolledAt: string }).lastPolledAt,
    ).toBe("string");
  });

  it("propagates a client failure instead of reporting an empty poll", async () => {
    // Returning [] here would be indistinguishable from "nothing new" and the
    // trigger would look healthy while silently doing nothing (rule §1).
    listMock.mockRejectedValue(new Error("BambooHR trigger: 500"));

    await expect(polling.poll(ctx())).rejects.toThrow("BambooHR trigger: 500");
  });

  it("polls no faster than a quarter hour by default", () => {
    expect(polling.defaultIntervalSeconds).toBe(900);
  });
});
