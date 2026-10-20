import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkflowToast from "./WorkflowToast";
const notification = { id: "synthetic", title: "Schedule confirmed", message: "Job SYN-1 is Ready to Schedule", event_type: "schedule_ready" as const };
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows a five-second nonblocking notice without marking anything read", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  render(<WorkflowToast notification={notification} onDismiss={dismiss} onOpen={open} />);
  expect(screen.getByRole("status")).toHaveTextContent("Schedule confirmed");
  act(() => { vi.advanceTimersByTime(4900); }); expect(dismiss).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(200); }); expect(dismiss).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
it("pauses for hover and keyboard focus and offers a separate open action", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  render(<WorkflowToast notification={notification} onDismiss={dismiss} onOpen={open} />);
  fireEvent.mouseEnter(screen.getByRole("status")); act(() => { vi.advanceTimersByTime(6000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("status"));
  fireEvent.focus(screen.getByRole("button", { name: "View job" })); act(() => { vi.advanceTimersByTime(6000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View job" })); expect(open).toHaveBeenCalledOnce();
});
