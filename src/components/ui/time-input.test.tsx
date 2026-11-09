import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimeInput } from "./time-input";
import { formatTimeValue, parseTime } from "@/lib/time-value";
afterEach(cleanup);

function Harness(props: { initial?: string; required?: boolean; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(props.initial ?? "");
  return <TimeInput aria-label="Start" value={value} required={props.required} onChange={(next) => { setValue(next); props.onChange?.(next); }} />;
}
const column = (name: string) => within(screen.getByRole("group", { name }));

describe("TimeInput (themed time picker)", () => {
  it("replaces the native time input and shows a readable time", () => {
    const { container } = render(<Harness initial="13:00:00" />);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent("1:00 PM");
  });

  it("emits HH:mm as each part is picked", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent("Pick a time");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(column("Hour").getByRole("button", { name: "2" }));
    fireEvent.click(column("Minute").getByRole("button", { name: "45" }));
    fireEvent.click(column("AM or PM").getByRole("button", { name: "PM" }));
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["02:00", "02:45", "14:45"]);
    expect(screen.getByRole("button", { name: "Start" })).toHaveTextContent("2:45 PM");
  });

  it("keeps any saved minute (no rounding) and marks the current choice", () => {
    render(<Harness initial="13:07" />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(column("Minute").getByRole("button", { name: "07" })).toHaveAttribute("aria-pressed", "true");
    expect(column("Hour").getByRole("button", { name: "1" })).toHaveAttribute("aria-pressed", "true");
    expect(column("AM or PM").getByRole("button", { name: "PM" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clears to empty, and hides Clear when a time is required", () => {
    const onChange = vi.fn();
    render(<Harness initial="09:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
    cleanup();
    render(<Harness initial="09:30" required />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("converts 12 AM / 12 PM correctly and rejects bad values", () => {
    expect(formatTimeValue({ hour12: 12, minute: 0, pm: false })).toBe("00:00");
    expect(formatTimeValue({ hour12: 12, minute: 30, pm: true })).toBe("12:30");
    expect(parseTime("00:15")).toEqual({ hour12: 12, minute: 15, pm: false });
    expect(parseTime("23:59:00")).toEqual({ hour12: 11, minute: 59, pm: true });
    expect(parseTime("24:00")).toBeUndefined();
    expect(parseTime("")).toBeUndefined();
  });
});
