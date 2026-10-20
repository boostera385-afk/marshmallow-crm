import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NotificationsPage from "./NotificationsPage";
const state = vi.hoisted(() => ({ role: "processor", error: false, mark: vi.fn(), open: vi.fn(), refetch: vi.fn(), toastError: vi.fn() }));
const row = { id: "00000000-0000-4000-8000-000000000001", title: "CS Updated", message: "Job WF-1 has a response", lead_id: null, read: false,
  created_at: "2026-10-20T01:00:00Z", event_type: "update_answered", request_kind: "cx", request_id: "request", revision: 2, job_id: "WF-1", action_required: true };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "synthetic" } }) }));
vi.mock("@/hooks/useNotificationInbox", () => ({ useNotificationInbox: () => ({ data: { rows: [row], total: 55, unread_count: 30 }, isError: state.error, error: new Error("Denied"), isPending: false, isFetching: false, refetch: state.refetch }) }));
vi.mock("@/lib/workflow-inbox", () => ({ markInboxRead: state.mark, openInboxNotification: state.open }));
vi.mock("sonner", () => ({ toast: { error: state.toastError } }));
const mount = () => render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
afterEach(cleanup);
beforeEach(() => { state.role = "processor"; state.error = false; state.mark.mockReset(); state.open.mockReset(); state.refetch.mockReset(); state.toastError.mockReset(); });
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
