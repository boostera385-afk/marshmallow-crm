import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UrgentScheduleFilter } from "./UrgentScheduleFilter";

const rows = [{ customer_schedule_requirements: "Nov 30" }];

describe("UrgentScheduleFilter", () => {
  it("applies a preset from the Schedule header popover", () => {
    const onChange = vi.fn();
    render(<UrgentScheduleFilter value={{ mode: "all" }} onChange={onChange} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by schedule" }));
    fireEvent.click(screen.getByRole("button", { name: /Overdue \/ Today/ }));
    expect(onChange).toHaveBeenCalledWith({ mode: "due" });

    fireEvent.click(screen.getByRole("button", { name: "Filter by schedule" }));
    fireEvent.click(screen.getByRole("button", { name: /Next 7 Days/ }));
    const next = onChange.mock.calls[1][0];
    expect(next.mode).toBe("range");
    expect(next.label).toBe("Next 7 Days");
    expect(next.range.from).toBeInstanceOf(Date);
  });

  it("shows the active filter and clears it", () => {
    const onChange = vi.fn();
    render(<UrgentScheduleFilter value={{ mode: "undated" }} onChange={onChange} rows={rows} />);
    const trigger = screen.getByRole("button", { name: "Schedule filter: No date given" });
    expect(trigger).toHaveTextContent("No date given");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /Clear filter/ }));
    expect(onChange).toHaveBeenCalledWith({ mode: "all" });
  });

  it("does not offer Clear when no filter is active", () => {
    render(<UrgentScheduleFilter value={{ mode: "all" }} onChange={vi.fn()} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter by schedule" }));
    expect(screen.queryByRole("button", { name: /Clear filter/ })).toBeNull();
  });
});
