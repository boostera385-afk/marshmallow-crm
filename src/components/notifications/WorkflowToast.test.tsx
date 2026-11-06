import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WorkflowToast from "./WorkflowToast";
const request = { id: "synthetic-request", title: "Tech update answered", message: "Job SYN-1 has a reply", event_type: "update_answered" as const };
const scheduleReady = { id: "synthetic", title: "AI: Customer confirmed schedule — Ready to schedule",
  message: "Job ID: SYN-1\nCustomer: Jane Sample\nService: AC Repair\nSchedule: Tomorrow 10 AM\nCustomer said: \"Yes 10am works\"", event_type: "schedule_ready" as const };
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows a five-second nonblocking request notice without marking anything read", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  render(<WorkflowToast notification={request} onDismiss={dismiss} onOpen={open} />);
  expect(screen.getByRole("status")).toHaveTextContent("Tech update answered");
  act(() => { vi.advanceTimersByTime(4900); }); expect(dismiss).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(200); }); expect(dismiss).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
});
it("pauses for hover and keyboard focus and offers a separate open action", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  render(<WorkflowToast notification={request} onDismiss={dismiss} onOpen={open} />);
  fireEvent.mouseEnter(screen.getByRole("status")); act(() => { vi.advanceTimersByTime(6000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.mouseLeave(screen.getByRole("status"));
  fireEvent.focus(screen.getByRole("button", { name: "View request" })); act(() => { vi.advanceTimersByTime(6000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View request" })); expect(open).toHaveBeenCalledOnce();
});
it("keeps an AI schedule confirmation on screen with the job details until dismissed", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  render(<WorkflowToast notification={scheduleReady} onDismiss={dismiss} onOpen={open} />);
  const status = screen.getByRole("status");
  for (const text of ["AI: Customer confirmed schedule", "Job ID: SYN-1", "Customer: Jane Sample", "Service: AC Repair", "Schedule: Tomorrow 10 AM", "Customer said: \"Yes 10am works\""]) {
    expect(status).toHaveTextContent(text);
  }
  act(() => { vi.advanceTimersByTime(60000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" })); expect(dismiss).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "View job" })); expect(open).toHaveBeenCalledOnce();
});
it("keeps an AI 'customer requires new schedule' alert on screen with the customer's words and opens the job", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] }); const dismiss = vi.fn(); const open = vi.fn();
  const newSchedule = { id: "synthetic-new", title: "AI: Customer requires new schedule", event_type: "schedule_new_needed" as const,
    message: "Job ID: SYN-2\nCustomer: Jane Sample\nCustomer said: \"How about the 14th?\"\nTag changed by AI: Waiting for CX for schedule confirmation -> Customer Require New Schedule" };
  render(<WorkflowToast notification={newSchedule} onDismiss={dismiss} onOpen={open} />);
  const status = screen.getByRole("status");
  for (const text of ["AI: Customer requires new schedule", "Job ID: SYN-2", "Customer said: \"How about the 14th?\"", "-> Customer Require New Schedule"]) expect(status).toHaveTextContent(text);
  act(() => { vi.advanceTimersByTime(60000); }); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View job" })); expect(open).toHaveBeenCalledOnce();
});
