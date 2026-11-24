import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleRequirementChip } from "./ScheduleRequirementChip";

afterEach(() => cleanup());

const FULL = "Customer is available Nov 21 to Nov 24, afternoons only after 2pm";

describe("ScheduleRequirementChip", () => {
  it("stays one line and truncates instead of becoming a round multi-line blob", () => {
    render(<ScheduleRequirementChip summary="Nov 21 to Nov 24" full={FULL} onEdit={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /Edit schedule requirement/ });
    // Regression: the old chip was rounded-full with wrapping text, which turned into a circle.
    expect(chip).not.toHaveClass("rounded-full");
    expect(chip).toHaveClass("max-w-full", "min-w-0");
    const summary = screen.getByText("Nov 21 to Nov 24");
    expect(summary).toHaveClass("truncate");
    // Full saved text is still available on hover and to screen readers.
    expect(chip).toHaveAttribute("title", `Schedule Requirement: ${FULL} - click to edit`);
    expect(chip).toHaveAccessibleName(`Schedule Requirement: ${FULL}. Edit schedule requirement`);
  });

  it("opens the editor without triggering the card click", () => {
    const onEdit = vi.fn();
    const onCardClick = vi.fn();
    render(<div onClick={onCardClick}><ScheduleRequirementChip summary="Nov 24" full="Nov 24" onEdit={onEdit} /></div>);
    fireEvent.click(screen.getByRole("button"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("is read-only (no button) for roles without edit", () => {
    render(<ScheduleRequirementChip summary="Nov 24" full="Nov 24" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Schedule Requirement: Nov 24")).toBeInTheDocument();
  });

  it("offers Add schedule only to editors when nothing is saved", () => {
    const onEdit = vi.fn();
    const { rerender } = render(<ScheduleRequirementChip summary={null} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /Add schedule/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    rerender(<ScheduleRequirementChip summary={null} />);
    expect(screen.queryByText("Add schedule")).toBeNull();
  });
});
