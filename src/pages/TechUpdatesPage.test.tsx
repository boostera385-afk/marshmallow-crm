import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TechUpdatesPage from "./TechUpdatesPage";

const mocks = vi.hoisted(() => ({ role: "processor", complete: vi.fn(), acknowledge: vi.fn(), questionMore: vi.fn(), success: vi.fn() }));
const pending = {
  id: "00000000-0000-4000-8000-000000000003", lead_id: "00000000-0000-4000-8000-000000000002",
  request_kind: "tech", requested_by: "cs-user", requester_name: "Synthetic CS", recipient_cs: null, recipient_name: null,
  request_text: "Has the technician collected the part?", status: "pending", response_text: null, completed_at: null,
  completed_by_name: null, created_at: "2026-10-14T00:00:00Z", thread: [],
  customer: { job_id: "TECH-1", customer_name: "Synthetic Customer", customer_phone: "5550100000", customer_landline: null, customer_email: null,
    service_type: "Repair", service_details: "Synthetic", address: "10 Test St", city: "Miami", state: "FL", zip_code: "33101",
    customer_schedule_requirements: "Friday", scheduled_date: null, scheduled_time_start: null, scheduled_time_end: null },
  technician: { status: "urgent_job", tech_name: "Synthetic Tech", tech_number: "5550109999", terms: "quoted" },
};
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "processor" }, role: mocks.role }) }));
vi.mock("@/hooks/useCxUpdates", () => ({ UPDATE_QUERY_KEY: ["lead-update-requests"], useUpdateQueue: () => ({ data: { rows: [pending], total: 1 }, isError: false, isPending: false, isFetching: false }) }));
vi.mock("@/lib/cx-update-requests", () => ({ completeUpdateRequest: mocks.complete, acknowledgeUpdateRequest: mocks.acknowledge, questionMoreUpdateRequest: mocks.questionMore }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: vi.fn() } }));
const mount = (path = "/get-tech-update") => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[path]}><TechUpdatesPage /></MemoryRouter></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { mocks.role = "processor"; mocks.complete.mockReset(); mocks.acknowledge.mockReset(); mocks.questionMore.mockReset(); mocks.success.mockReset(); });

it("lets Processor answer a Tech Update request and shows technician context", async () => {
  mocks.complete.mockResolvedValue({ saved: true });
  mount();
  expect(screen.getByText(/Synthetic Tech/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mark Tech Updated" }));
  fireEvent.change(screen.getByLabelText("Tech update"), { target: { value: "Part collected" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Tech Updated" }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith("tech", pending.id, "Part collected"));
});

it("keeps Admin read-only while showing the Processor queue", () => {
  mocks.role = "admin";
  mount();
  expect(screen.getByText("Has the technician collected the part?")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark Tech Updated" })).toBeNull();
});
