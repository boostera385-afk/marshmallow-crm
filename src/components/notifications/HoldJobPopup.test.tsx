import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { AppRole } from "@/types";
import type { HoldAlert } from "@/lib/operator-workflow";
import HoldJobPopup from "./HoldJobPopup";
import { NotificationPopupProvider } from "./popup-slot";

const state = vi.hoisted(() => ({ role: "opr" as AppRole, user: { id: "test-user" }, alerts: [] as HoldAlert[], acknowledge: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/hooks/useOperatorWorkflow", () => ({ useHoldInbox: () => ({ data: { alerts: state.alerts, unread_count: state.alerts.length } }) }));
vi.mock("@/lib/operator-workflow", () => ({ acknowledgeHoldAlert: state.acknowledge }));
vi.mock("./HoldJobCard", () => ({ default: ({ alert, onAcknowledge, saving }: { alert: HoldAlert; onAcknowledge: (alert: HoldAlert) => void; saving: boolean }) =>
  <div><p>{alert.revision}</p><button disabled={saving} onClick={() => onAcknowledge(alert)}>Acknowledge</button></div> }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
const current: HoldAlert = {
  id: "alert-1", lead_id: "lead-1", revision: "revision-1", reason: "scheduled", read: false, created_at: "2026-10-12T05:00:00Z",
  snapshot: { job_id: "MM-TEST", customer_name: "Synthetic", customer_phone: null, customer_landline: null,
    service_type: null, service_details: null, address: null, city: null, state: null, zip_code: null,
    customer_schedule_requirements: null, scheduled_date: null, scheduled_time_start: null, scheduled_time_end: null,
    tech_name: null, tech_number: null, status: "scheduled", cs_tag: null, quote: null },
};
const clients: QueryClient[] = [];
function renderPopup() {
  const client = new QueryClient();
  clients.push(client);
  const ui = <QueryClientProvider client={client}><NotificationPopupProvider><HoldJobPopup /></NotificationPopupProvider></QueryClientProvider>;
  return { ...render(ui), ui, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "opr";
  state.alerts = [current];
  state.acknowledge.mockResolvedValue(true);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });
describe("Operator hold popup delivery", () => {
  it("keeps the alert available after an acknowledgement failure", async () => {
    state.acknowledge.mockRejectedValue(new Error("Offline"));
    renderPopup();
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not acknowledge: Offline"));
    expect(screen.getByRole("complementary", { name: "Operator job hold notification" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Acknowledge" })).not.toBeDisabled();
  });
  it("warns about a concurrent refresh rather than claiming an acknowledgement", async () => {
    state.acknowledge.mockResolvedValue(false);
    const { client } = renderPopup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("This job changed again. Review the latest alert before acknowledging."));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["operator-hold-alerts"] });
  });
  it("hides without acknowledging, then resurfaces a newer revision", async () => {
    const { client, rerender } = renderPopup();
    fireEvent.click(await screen.findByRole("button", { name: "Hide hold notification" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(state.acknowledge).not.toHaveBeenCalled();
    state.alerts = [{ ...current, revision: "revision-2" }];
    rerender(<QueryClientProvider client={client}><NotificationPopupProvider><HoldJobPopup /></NotificationPopupProvider></QueryClientProvider>);
    expect(await screen.findByText("revision-2")).toBeInTheDocument();
  });
  it("does not render snapshots for an excluded role", () => {
    state.role = "customer_service";
    renderPopup();
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});
