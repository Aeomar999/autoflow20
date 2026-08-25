import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpgradeModal } from "./upgrade-modal";

describe("UpgradeModal", () => {
  it("renders nothing when closed", () => {
    render(<UpgradeModal open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText("Upgrade to Pro")).not.toBeInTheDocument();
  });

  it("shows title and description when open", () => {
    render(<UpgradeModal open onOpenChange={() => {}} />);
    expect(screen.getByText("Upgrade to Pro")).toBeInTheDocument();
    expect(
      screen.getByText(/active subscription to perform this action/i),
    ).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(<UpgradeModal open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
