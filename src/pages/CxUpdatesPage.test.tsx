import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CxUpdatesPage from "./CxUpdatesPage";
const mocks = vi.hoisted(() => ({ role: "customer_service", updated: false, complete: vi.fn(), acknowledge: vi.fn(), questionMore: vi.fn(), success: vi.fn(), error: vi.fn(), queueError: false }));
const row = {
  id: "request", lead_id: "hidden", requested_by: "processor", requester_name: "Synthetic Processor", recipient_name: "Synthetic CS",
  request_text: "Confirm Friday availability", status: "pending", response_text: null,
  customer: { job_id: "CX-HIDDEN", customer_name: "Synthetic Customer", customer_phone: "5550100000", service_type: "Plumbing", address: "10 Test St Apt 2", customer_schedule_requirements: "Friday afternoon" },
};
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "processor" }, role: mocks.role }) }));
vi.mock("@/hooks/useCxUpdates", () => ({ UPDATE_QUERY_KEY: ["lead-update-requests"], useUpdateQueue: () => ({ data: { rows: [mocks.updated ? { ...row, status: "cs_updated", response_text: "Friday confirmed", completed_at: "2026-10-14T01:00:00Z" } : row], total: 1 }, isError: mocks.queueError, error: new Error("Queue unavailable"), isPending: false, isFetching: false }) }));
vi.mock("@/lib/cx-update-requests", () => ({ completeUpdateRequest: mocks.complete, acknowledgeUpdateRequest: mocks.acknowledge, questionMoreUpdateRequest: mocks.questionMore }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
const mount = (path = "/get-cx-update") => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><CxUpdatesPage /></MemoryRouter></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { mocks.role = "customer_service"; mocks.updated = false; mocks.queueError = false; mocks.complete.mockReset(); mocks.acknowledge.mockReset(); mocks.questionMore.mockReset(); mocks.success.mockReset(); mocks.error.mockReset(); });
it("offers customer-only details without full-lead navigation to both CS roles", () => {
  for (const role of ["customer_service", "cs_admin"]) {
    mocks.role = role; const view = mount();
    expect(screen.getByText("10 Test St Apt 2")).toBeInTheDocument();
    expect(screen.getByText("Friday afternoon")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open lead" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mark CS Updated" })).toBeEnabled();
    view.unmount();
  }
});
it("saves the typed response once and removes the request only on acknowledged success", async () => {
  mocks.complete.mockResolvedValue({ saved: true }); mount();
  fireEvent.click(screen.getByRole("button", { name: "Mark CS Updated" }));
  expect(screen.getByRole("button", { name: "Save CS Updated" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Customer update"), { target: { value: "Friday confirmed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save CS Updated" }));
  await waitFor(() => expect(screen.queryByText("Synthetic Customer")).toBeNull());
  expect(mocks.complete).toHaveBeenCalledWith("cx", "request", "Friday confirmed");
  expect(mocks.success).toHaveBeenCalledTimes(1);
});
it("retains request and response when completion is denied", async () => {
  mocks.complete.mockRejectedValue(new Error("This request was already updated. Refresh the queue.")); mount();
  fireEvent.click(screen.getByRole("button", { name: "Mark CS Updated" }));
  fireEvent.change(screen.getByLabelText("Customer update"), { target: { value: "Friday confirmed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save CS Updated" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Customer update")).toHaveValue("Friday confirmed");
  expect(screen.getByText("Synthetic Customer")).toBeInTheDocument();
  expect(mocks.success).not.toHaveBeenCalled();
});
it("does not render stale request data as an accessible queue after a fetch denial", () => {
  mocks.queueError = true; mount();
  expect(screen.getByRole("alert")).toHaveTextContent("Queue unavailable");
  expect(screen.queryByText("Synthetic Customer")).toBeNull();
});
it("denies excluded roles even when the component is opened directly", () => {
  mocks.role = "opr_admin"; mount();
  expect(screen.getByRole("alert")).toHaveTextContent("do not have access");
  expect(screen.queryByText("Synthetic Customer")).toBeNull();
});

it("lets the requesting Processor ask a follow-up instead of acknowledging", async () => {
  mocks.role = "processor";
  mocks.updated = true;
  mocks.questionMore.mockResolvedValue({ saved: true });
  mount("/get-cx-update?tab=updated");
  fireEvent.click(screen.getByRole("button", { name: "Question More" }));
  fireEvent.change(screen.getByLabelText("Follow-up question"), { target: { value: "Can you confirm the exact time?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(mocks.questionMore).toHaveBeenCalledWith("cx", "request", "Can you confirm the exact time?"));
});
