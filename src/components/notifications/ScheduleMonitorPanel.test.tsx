import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ScheduleMonitorPanel from "./ScheduleMonitorPanel";
const state = vi.hoisted(() => ({ role: "admin", fetch: vi.fn(), save: vi.fn(), success: vi.fn(), error: vi.fn() }));
const config = { mode: "off", timezone: "America/New_York", changed_at: "2026-10-20T00:00:00Z", cooldown_until: null, shadow_started_at: null,
  accepted: 0, rejected: 0, daily_checks: 0, ingestion_paused: false, rows: [], total: 0 };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "synthetic" } }) }));
vi.mock("@/lib/schedule-monitor", () => ({ fetchScheduleMonitor: state.fetch, changeScheduleMonitor: state.save }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); const view = render(<QueryClientProvider client={client}><ScheduleMonitorPanel /></QueryClientProvider>); return { ...view, client }; }
function expand() { const details = screen.getByText(/Schedule confirmation monitor · Admin controls/).closest("details")!; details.open = true; fireEvent(details, new Event("toggle")); }
beforeEach(() => { state.role = "admin"; state.fetch.mockReset().mockResolvedValue(config); state.save.mockReset().mockResolvedValue({ saved: true }); state.success.mockReset(); state.error.mockReset(); });
afterEach(cleanup);
it("does no monitor reads until Admin explicitly expands its controls", async () => {
  mount(); expect(state.fetch).not.toHaveBeenCalled(); expand();
  await screen.findByLabelText("Mode"); expect(state.fetch).toHaveBeenCalledOnce();
});
it("saves a reason and the draft's original configuration revision, not a silent enable", async () => {
  mount(); expand(); await screen.findByLabelText("Mode");
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "shadow" } });
  expect(screen.getByRole("button", { name: "Save monitor configuration" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Configuration reason / shadow review summary"), { target: { value: "Approved synthetic shadow evaluation" } });
  fireEvent.click(screen.getByRole("button", { name: "Save monitor configuration" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith({ action: "configure", mode: "shadow", timezone: "America/New_York", reason: "Approved synthetic shadow evaluation", expectedChangedAt: config.changed_at }));
});
it("preserves a dirty draft after another Admin changes configuration or save fails", async () => {
  state.save.mockRejectedValue(new Error("Configuration changed"));
  const { client } = mount(); expand(); await screen.findByLabelText("Mode");
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "shadow" } });
  fireEvent.change(screen.getByLabelText("Configuration reason / shadow review summary"), { target: { value: "My retained shadow review draft" } });
  client.setQueryData(["schedule-monitor", "synthetic", "admin", 0], { ...config, changed_at: "2026-10-20T01:00:00Z" });
  await screen.findByRole("alert"); expect(screen.getByLabelText("Mode")).toHaveValue("shadow");
  fireEvent.click(screen.getByRole("button", { name: "Save monitor configuration" }));
  await waitFor(() => expect(state.error).toHaveBeenCalledWith("Configuration changed"));
  expect(screen.getByLabelText("Configuration reason / shadow review summary")).toHaveValue("My retained shadow review draft");
  expect(state.success).not.toHaveBeenCalled();
});
it("never fetches Admin configuration for a Processor", () => {
  state.role = "processor"; mount(); expect(state.fetch).not.toHaveBeenCalled(); expect(screen.queryByText(/Admin controls/)).not.toBeInTheDocument();
});
