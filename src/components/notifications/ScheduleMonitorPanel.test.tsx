import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ScheduleMonitorPanel from "./ScheduleMonitorPanel";
const state = vi.hoisted(() => ({ role: "admin", fetch: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
const job = { lead_id: "16000000-0000-4000-8000-000000000010", job_id: "SYN-1", status: "urgent_job", customer_name: "Jane Sample", service_type: "AC Repair",
  schedule_requirements: "Tomorrow 10 AM", eligible: true, state: "checked", waiting_since: "2026-11-30T10:00:00Z", checked_at: "2026-11-30T12:01:00Z",
  result: { decision: "confirmed", reason: "Customer agreed to 10 AM.", quote: "Yes 10am works", evidence_id: "m1", applied: true },
  evidence: { text: "Yes 10am works", message_time: "2026-11-30T12:00:00Z" } };
const config = { mode: "off", changed_at: "2026-10-20T00:00:00Z", cooldown_until: null, daily_checks: 0, daily_limit: 200, ingestion_paused: false, rows: [], total: 0 };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "synthetic" } }) }));
vi.mock("@/lib/schedule-monitor", () => ({ fetchScheduleMonitor: state.fetch, changeScheduleMonitor: state.save }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const view = render(<QueryClientProvider client={client}><ScheduleMonitorPanel /></QueryClientProvider>); return { ...view, client }; }
function expand() { const details = screen.getByText(/AI schedule confirmation · Admin controls/).closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); }
beforeEach(() => { state.role = "admin"; state.fetch.mockReset().mockResolvedValue(config); state.save.mockReset().mockResolvedValue({ saved: true }); state.success.mockReset(); state.error.mockReset(); });
afterEach(cleanup);
it("does no reads until Admin explicitly expands its controls", async () => {
  mount(); expect(state.fetch).not.toHaveBeenCalled(); expand();
  await screen.findByLabelText("Mode"); expect(state.fetch).toHaveBeenCalledOnce();
});
it("turns the AI on only with a reason and the revision the Admin was looking at", async () => {
  mount(); expand(); await screen.findByLabelText("Mode");
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "automatic" } });
  expect(screen.getByRole("button", { name: "Save setting" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "Business approved AI tagging" } });
  fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith({ action: "configure", mode: "automatic", reason: "Business approved AI tagging", expectedChangedAt: config.changed_at }));
  expect(state.success).toHaveBeenCalled();
});
it("keeps a draft after another Admin changes the setting or the save fails", async () => {
  state.save.mockRejectedValue(new Error("Monitor configuration changed. Refresh and review it before saving."));
  const { client } = mount(); expand(); await screen.findByLabelText("Mode");
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "shadow" } });
  fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "My retained shadow draft" } });
  client.setQueryData(["schedule-monitor", "synthetic", "admin", 0], { ...config, changed_at: "2026-10-20T01:00:00Z" });
  await screen.findByRole("alert"); expect(screen.getByLabelText("Mode")).toHaveValue("shadow");
  fireEvent.click(screen.getByRole("button", { name: "Save setting" }));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith("Monitor configuration changed. Refresh and review it before saving."));
  expect(screen.getByLabelText("Reason for the change")).toHaveValue("My retained shadow draft");
  expect(state.success).not.toHaveBeenCalled();
});
it("shows each waiting job's AI result with the customer's words and can check again", async () => {
  state.fetch.mockResolvedValue({ ...config, mode: "automatic", rows: [job], total: 1 });
  mount(); expand();
  expect(await screen.findByText("SYN-1 · Jane Sample")).toBeInTheDocument();
  expect(screen.getByText("AI: customer confirmed. Tag changed to Ready to schedule.")).toBeInTheDocument();
  expect(screen.getByText("“Yes 10am works”")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Reason to check again"), { target: { value: "Customer sent another text" } });
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith({ action: "retry", leadId: job.lead_id, reason: "Customer sent another text" }));
});
it("never fetches Admin configuration for a Processor", () => {
  state.role = "processor"; mount(); expect(state.fetch).not.toHaveBeenCalled(); expect(screen.queryByText(/Admin controls/)).not.toBeInTheDocument();
});
