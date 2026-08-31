import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CostSummaryCards } from "./cost-summary-cards";

const baseProps = {
  costUsd: 12.3456,
  runs: 42,
  tokensIn: 1_200_000,
  tokensOut: 300_000,
};

describe("CostSummaryCards", () => {
  it("shows real spend, run count, and combined tokens", () => {
    render(<CostSummaryCards {...baseProps} cache={null} />);

    expect(screen.getByText("$12.35")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("1.5M")).toBeInTheDocument();
  });

  it("reports the hit rate with the runs it was measured over", () => {
    render(
      <CostSummaryCards
        {...baseProps}
        cache={{ hits: 3, misses: 1, hitRate: 0.75, savedUsd: 0.5 }}
      />,
    );

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(
      screen.getByText(/3 of 4 cached nodes · \$0\.5000 avoided/),
    ).toBeInTheDocument();
  });

  it("says no cached nodes have run rather than implying a 0% hit rate", () => {
    render(
      <CostSummaryCards
        {...baseProps}
        cache={{ hits: 0, misses: 0, hitRate: 0, savedUsd: 0 }}
      />,
    );

    expect(
      screen.getByText("No cached AI nodes have run yet"),
    ).toBeInTheDocument();
  });
});
