import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import { toast } from "sonner";
import LeadCopyAccessSettings from "./LeadCopyAccessSettings";
const state = vi.hoisted(() => ({ role: "admin" as AppRole, user: { id: "admin" }, fetch: vi.fn(), save: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/operator-workflow", async (original) => ({ ...await original<typeof import("@/lib/operator-workflow")>(), fetchLeadCopySettings: state.fetch, setLeadCopyPermission: state.save }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><LeadCopyAccessSettings users={[
    { id: "operator", full_name: "Test Operator", role: "opr" },
  ]} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
  state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: true }], users: [] });
  state.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("admin copy access settings", () => {
  it("saves a role denial and refreshes effective user access", async () => {
    renderSettings();
    const control = screen.getByRole("switch", { name: "Allow Copy Complete Details for Operator" });
    await waitFor(() => expect(control).not.toBeDisabled());
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: [] });
    fireEvent.click(control);
    await waitFor(() => expect(state.save).toHaveBeenCalledWith("opr", null, false));
    await waitFor(() => expect(control).not.toBeChecked());
    expect(screen.getByText("Operator · Effective access: Denied")).toBeInTheDocument();
  });
  it("reports a failed save without pretending access changed", async () => {
    renderSettings();
    const control = screen.getByRole("switch", { name: "Allow Copy Complete Details for Operator" });
    await waitFor(() => expect(control).not.toBeDisabled());
    state.save.mockRejectedValue(new Error("Not authorized"));
    fireEvent.click(control);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Not authorized"));
    expect(control).toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("shows backend errors and disables controls instead of offering fake defaults", async () => {
    state.fetch.mockRejectedValue(new Error("Apply migration"));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("Apply migration");
    expect(screen.getByRole("switch", { name: "Allow Copy Complete Details for Operator" })).toBeDisabled();
  });
  it("does not expose the controls to an excluded role", () => {
    state.role = "cs_admin";
    renderSettings();
    expect(screen.queryByText("Copy Complete Details")).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
