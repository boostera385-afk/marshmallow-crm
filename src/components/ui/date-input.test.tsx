import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DateInput } from "./date-input";
import { parseIsoDay, toIsoDay } from "@/lib/date-value";
afterEach(cleanup);

function Harness(props: { initial?: string; min?: string; max?: string; required?: boolean; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(props.initial ?? "");
  return <DateInput aria-label="Pick" value={value} min={props.min} max={props.max} required={props.required}
    onChange={(next) => { setValue(next); props.onChange?.(next); }} />;
}
const day = (n: string) => within(screen.getByRole("dialog")).getAllByRole("gridcell", { name: n })
  .find((cell) => !cell.className.includes("day-outside"))!;

describe("DateInput (themed date picker)", () => {
  it("opens the app calendar instead of a native date input", () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Pick" })).toHaveTextContent("Pick a date");
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the YYYY-MM-DD value and shows it readably", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-15" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Pick" })).toHaveTextContent("Oct 15, 2026");
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.click(day("20"));
    expect(onChange).toHaveBeenCalledWith("2026-10-20");
    expect(screen.getByRole("button", { name: "Pick" })).toHaveTextContent("Oct 20, 2026");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("disables days outside min/max", () => {
    render(<Harness initial="2026-10-15" min="2026-10-10" max="2026-10-20" />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(day("9")).toBeDisabled();
    expect(day("21")).toBeDisabled();
    expect(day("10")).not.toBeDisabled();
  });

  it("clears to an empty value, and hides Clear when a date is required", () => {
    const onChange = vi.fn();
    render(<Harness initial="2026-10-15" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
    cleanup();
    render(<Harness initial="2026-10-15" required />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("Today picks today's local date", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledWith(toIsoDay(new Date()));
  });

  it("parses days without a time-zone shift and rejects bad values", () => {
    expect(toIsoDay(parseIsoDay("2026-11-01")!)).toBe("2026-11-01");
    expect(parseIsoDay("")).toBeUndefined();
    expect(parseIsoDay("11/01/2026")).toBeUndefined();
    expect(parseIsoDay("2026-02-31")).toBeUndefined();
  });
});
