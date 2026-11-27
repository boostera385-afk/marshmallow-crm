import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useHoverOpen } from "./useHoverOpen";

function HoverPopover() {
  const { open, onOpenChange, hoverProps, triggerProps } = useHoverOpen();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" {...hoverProps} onClick={triggerProps.onClick}>Tech status</button>
      </PopoverTrigger>
      <PopoverContent {...hoverProps}>Techs for this job</PopoverContent>
    </Popover>
  );
}

const mouse = { pointerType: "mouse" }; // jsdom ignores it; the hook treats unknown as a mouse

describe("useHoverOpen", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens when the mouse rests on the trigger and closes after it leaves", () => {
    render(<HoverPopover />);
    const trigger = screen.getByRole("button", { name: "Tech status" });
    fireEvent.pointerEnter(trigger, mouse);
    expect(screen.queryByText("Techs for this job")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("Techs for this job")).toBeInTheDocument();
    fireEvent.pointerLeave(trigger, mouse);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByText("Techs for this job")).not.toBeInTheDocument();
  });

  it("stays open while the mouse moves from the trigger into the popup", () => {
    render(<HoverPopover />);
    const trigger = screen.getByRole("button", { name: "Tech status" });
    fireEvent.pointerEnter(trigger, mouse);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerLeave(trigger, mouse);
    fireEvent.pointerEnter(screen.getByText("Techs for this job"), mouse);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("Techs for this job")).toBeInTheDocument();
  });

  it("a click on a hover-opened trigger pins it instead of closing it", () => {
    render(<HoverPopover />);
    const trigger = screen.getByRole("button", { name: "Tech status" });
    fireEvent.pointerEnter(trigger, mouse);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(trigger);
    fireEvent.pointerLeave(trigger, mouse);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText("Techs for this job")).toBeInTheDocument();
  });

  it("ignores touch hover; a tap still opens", () => {
    render(<HoverPopover />);
    const trigger = screen.getByRole("button", { name: "Tech status" });
    // jsdom drops pointerType from PointerEvent init, so set it on the native event.
    const touch = new Event("pointerover", { bubbles: true });
    Object.defineProperty(touch, "pointerType", { value: "touch" });
    fireEvent(trigger, touch);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("Techs for this job")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByText("Techs for this job")).toBeInTheDocument();
  });
});
