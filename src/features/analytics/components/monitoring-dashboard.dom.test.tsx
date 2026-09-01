import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DailyStatusPoint, MonitoringOverview } from "../lib/types";

/**
 * The dashboard reads its data through a suspense query and its window through
 * nuqs. Both are transport, not presentation — mocking the hook lets these
 * tests cover the part this component is actually responsible for: whether the
 * numbers it prints are honest about what they measure.
 */
const mockData = vi.hoisted(() => ({
  current: null as MonitoringOverview | null,
}));

vi.mock("../hooks/use-monitoring", () => ({
  useSuspenseMonitoringOverview: () => ({ data: mockData.current }),
}));

vi.mock("../hooks/use-monitoring-params", () => ({
  useMonitoringParams: () => ({ days: 30, setDays: () => {} }),
}));

import { MonitoringDashboard } from "./monitoring-dashboard";

function day(
  date: string,
  counts: Partial<DailyStatusPoint>,
): DailyStatusPoint {
  return {
    date,
    SUCCESS: 0,
    FAILED: 0,
    CANCELLED: 0,
    TIMED_OUT: 0,
    QUOTA_EXCEEDED: 0,
    RUNNING: 0,
    ...counts,
  };
}

function overview(patch: Partial<MonitoringOverview> = {}): MonitoringOverview {
  return {
    periodDays: 30,
    since: new Date("2026-08-01T00:00:00Z"),
    overview: {
      totalRuns: 0,
      successRate: 0,
      avgDurationMs: null,
      p50DurationMs: null,
      p95DurationMs: null,
    },
    executionsOverTime: [],
    errorBreakdown: [],
    topFailingWorkflows: [],
    usage: {
      currentMonthCount: 0,
      planLimit: 100,
      plan: "FREE",
      remaining: 100,
    },
    ...patch,
  };
}

function renderWith(data: MonitoringOverview) {
  mockData.current = data;
  return render(<MonitoringDashboard />);
}

describe("MonitoringDashboard", () => {
  it("distinguishes run duration from step duration", () => {
    // `avgDurationMs` is the mean of Execution.durationMs; p50/p95 are
    // percentiles over NodeExecution.durationMs. Three cards in a row that all
    // said "Duration" invited reading them as one distribution.
    renderWith(
      overview({
        overview: {
          totalRuns: 10,
          successRate: 90,
          avgDurationMs: 4200,
          p50DurationMs: 120,
          p95DurationMs: 3400,
        },
        executionsOverTime: [day("2026-08-30", { SUCCESS: 9, FAILED: 1 })],
      }),
    );

    expect(screen.getByText("Avg run")).toBeInTheDocument();
    expect(screen.getByText("p50 step")).toBeInTheDocument();
    expect(screen.getByText("p95 step")).toBeInTheDocument();
    expect(screen.getByText("Mean end-to-end run time")).toBeInTheDocument();
    expect(screen.getByText("Median single node step")).toBeInTheDocument();
  });

  it("breaks a success rate down into the counts behind it", () => {
    // The reported failure: "0%" beside "2 total runs", with no way to tell
    // whether the other two were failures or still in flight.
    renderWith(
      overview({
        overview: {
          totalRuns: 2,
          successRate: 0,
          avgDurationMs: null,
          p50DurationMs: null,
          p95DurationMs: null,
        },
        executionsOverTime: [day("2026-08-30", { FAILED: 2 })],
      }),
    );

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("0 succeeded · 2 failed")).toBeInTheDocument();
  });

  it("counts in-flight runs as running rather than as failures", () => {
    renderWith(
      overview({
        overview: {
          totalRuns: 3,
          successRate: 33,
          avgDurationMs: null,
          p50DurationMs: null,
          p95DurationMs: null,
        },
        executionsOverTime: [day("2026-08-30", { SUCCESS: 1, RUNNING: 2 })],
      }),
    );

    expect(screen.getByText("2 still running")).toBeInTheDocument();
    expect(screen.getByText("1 succeeded · 0 failed")).toBeInTheDocument();
  });

  it("says why a duration is missing instead of printing a bare dash", () => {
    renderWith(
      overview({ overview: { ...overview().overview, totalRuns: 2 } }),
    );

    expect(screen.getByText("No run has finished yet")).toBeInTheDocument();
    expect(screen.getAllByText("No step has completed yet")).toHaveLength(2);
  });

  it("shows an empty workspace no percentage at all", () => {
    renderWith(overview());

    expect(screen.getByText("No runs to measure yet")).toBeInTheDocument();
    expect(
      screen.getByText(/No executions in this window/),
    ).toBeInTheDocument();
  });

  it("explains what an empty breakdown means", () => {
    renderWith(overview());

    expect(
      screen.getByText("No node has failed in this window."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No workflow has failed in this window."),
    ).toBeInTheDocument();
  });

  it("warns that runs are now failing when the quota is spent", () => {
    renderWith(
      overview({
        usage: {
          currentMonthCount: 100,
          planLimit: 100,
          plan: "FREE",
          remaining: 0,
        },
      }),
    );

    expect(screen.getByText(/Limit reached/)).toBeInTheDocument();
    expect(screen.getByText(/QUOTA_EXCEEDED/)).toBeInTheDocument();
  });

  it("does not draw a progress bar for an unlimited plan", () => {
    renderWith(
      overview({
        usage: {
          currentMonthCount: 4210,
          planLimit: null,
          plan: "ENTERPRISE",
          remaining: null,
        },
      }),
    );

    expect(screen.getByText("of unlimited")).toBeInTheDocument();
    expect(
      screen.getByText("This plan has no monthly execution limit."),
    ).toBeInTheDocument();
  });

  it("links a failing workflow to the workflow it names", () => {
    renderWith(
      overview({
        topFailingWorkflows: [
          {
            workflowId: "wf_123",
            workflowName: "Nightly sync",
            failures: 4,
            lastFailureAt: new Date("2026-08-30T10:00:00Z"),
          },
        ],
      }),
    );

    const link = screen.getByRole("link", { name: "Nightly sync" });
    expect(link).toHaveAttribute("href", "/workflows/wf_123");
  });
});

/**
 * AF-M8-20: retention is per-plan, so a range wider than the plan keeps renders
 * as a period that merely contains fewer runs — indistinguishable from a quiet
 * month unless the page says which it is.
 */
describe("MonitoringDashboard — retention honesty", () => {
  it("warns when the range is wider than the plan keeps run history", () => {
    renderWith(overview({ periodDays: 90 }));

    // FREE deletes runs at 35 days, so a 90-day view cannot show 90 days.
    expect(screen.getByRole("note")).toHaveTextContent(
      /keeps run history for 35 days/,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/at most 35 days/);
  });

  it("warns about erased payloads when only those have aged out", () => {
    // FREE erases inputs/outputs at 7 days but keeps runs to 35: over 30 days
    // the history is complete and the detail is not.
    renderWith(overview({ periodDays: 30 }));

    expect(screen.getByRole("note")).toHaveTextContent(
      /inputs and outputs have been erased/,
    );
  });

  it("stays silent when the range fits inside the plan's windows", () => {
    renderWith(
      overview({
        periodDays: 30,
        usage: {
          currentMonthCount: 0,
          planLimit: null,
          plan: "PRO",
          remaining: null,
        },
      }),
    );

    expect(screen.queryByRole("note")).toBeNull();
  });

  it("treats an unrecognised plan as FREE rather than unlimited", () => {
    renderWith(
      overview({
        periodDays: 90,
        usage: {
          currentMonthCount: 0,
          planLimit: 100,
          plan: "LEGACY",
          remaining: 100,
        },
      }),
    );

    expect(screen.getByRole("note")).toHaveTextContent(/35 days/);
  });
});
