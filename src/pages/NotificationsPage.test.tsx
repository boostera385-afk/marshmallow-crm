import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NotificationsPage from "./NotificationsPage";
const state = vi.hoisted(() => ({ role: "processor", error: false, rows: null as unknown[] | null, mark: vi.fn(), open: vi.fn(), refetch: vi.fn(), toastError: vi.fn() }));
const row = { id: "00000000-0000-4000-8000-000000000001", title: "CS Updated", message: "Job WF-1 has a response", lead_id: null, read: false,
  created_at: "2026-10-20T01:00:00Z", event_type: "update_answered", request_kind: "cx", request_id: "request", revision: 2, job_id: "WF-1", action_required: true };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "synthetic" } }) }));
vi.mock("@/hooks/useNotificationInbox", () => ({ useNotificationInbox: () => ({ data: { rows: state.rows ?? [row], total: 55, unread_count: 30 }, isError: state.error, error: new Error("Denied"), isPending: false, isFetching: false, refetch: state.refetch }) }));
vi.mock("@/lib/workflow-inbox", () => ({ markInboxRead: state.mark, openInboxNotification: state.open }));
vi.mock("sonner", () => ({ toast: { error: state.toastError } }));
const mount = () => render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
afterEach(cleanup);
beforeEach(() => { state.role = "processor"; state.error = false; state.rows = null; state.mark.mockReset(); state.open.mockReset(); state.refetch.mockReset(); state.toastError.mockReset(); });
it("shows exact history totals and permits navigation beyond the bell page", () => {
  mount(); expect(screen.getByText("30 unread · 55 matching")).toBeInTheDocument();
  expect(screen.getByText("Action required", { selector: "span" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" })); expect(screen.getByText("Page 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
});
it("marks only the displayed snapshot read, never resolves work", async () => {
  state.mark.mockResolvedValue({ saved: true }); mount();
  fireEvent.click(screen.getByRole("button", { name: "Mark this page read" }));
  await waitFor(() => expect(state.mark).toHaveBeenCalledWith([row.id]));
  expect(state.open).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Mark Resolved" })).not.toBeInTheDocument();
});
it("keeps notification and badge visible after read failure", async () => {
  state.mark.mockRejectedValue(new Error("Save unavailable")); mount();
  fireEvent.click(screen.getByRole("button", { name: "Mark this page read" }));
  await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Save unavailable"));
  expect(screen.getByText(row.message)).toBeInTheDocument(); expect(screen.getByText("30 unread · 55 matching")).toBeInTheDocument();
});
it("does not show stale rows after access denial", () => {
  state.error = true; mount(); expect(screen.getByRole("alert")).toHaveTextContent("Notifications unavailable"); expect(screen.queryByText(row.message)).not.toBeInTheDocument();
});
it("denies excluded Operator roles", () => {
  state.role = "opr"; mount(); expect(screen.getByRole("alert")).toHaveTextContent("do not have access"); expect(screen.queryByText(row.message)).not.toBeInTheDocument();
});
it("colours each notification by severity with an icon and a text label", () => {
  const at = (n: number) => `00000000-0000-4000-8000-00000000001${n}`;
  state.rows = [
    { ...row, id: at(1), title: "[Alert] Urgent Job", message: 'Lead "A" changed to Urgent Job', event_type: null, action_required: false },
    { ...row, id: at(2), title: "Lead cancellation request", message: "Jeremy needs cancellation approval", event_type: null, action_required: true },
    { ...row, id: at(3), title: "Database load back to normal", message: "All readings normal", event_type: null, action_required: false, read: true },
    { ...row, id: at(4), title: "Lead Assigned", message: "LD-9 was assigned to you", event_type: null, action_required: false },
  ];
  mount();
  const rowOf = (title: string) => screen.getByText(title).closest("button") as HTMLElement;
  expect(rowOf("[Alert] Urgent Job")).toHaveAttribute("data-severity", "critical");
  expect(rowOf("[Alert] Urgent Job")).toHaveTextContent("Critical");
  expect(rowOf("[Alert] Urgent Job").className).toContain("border-l-red-500");
  // An approval keeps its "Action required" label, without a duplicate "Needs action".
  expect(rowOf("Lead cancellation request")).toHaveAttribute("data-severity", "warning");
  expect(rowOf("Lead cancellation request")).toHaveTextContent("Action required");
  expect(rowOf("Lead cancellation request")).not.toHaveTextContent("Needs action");
  expect(rowOf("Database load back to normal")).toHaveAttribute("data-severity", "success");
  expect(rowOf("Database load back to normal")).toHaveTextContent("Resolved");
  // Read rows keep the colour edge but drop the unread tint.
  expect(rowOf("Database load back to normal").className).not.toContain("bg-emerald-500/[0.05]");
  expect(rowOf("Lead Assigned")).toHaveAttribute("data-severity", "info");
  expect(rowOf("Lead Assigned")).not.toHaveTextContent("Info");
});
