import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import CopilotAccessSettings from "./CopilotAccessSettings";
import type { CopilotSettings } from "@/lib/copilot-api";
const state = vi.hoisted(() => ({ role: "admin", user: { id: "admin" }, fetch: vi.fn(), permission: vi.fn(), configure: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/copilot-api", async (original) => ({ ...await original<typeof import("@/lib/copilot-api")>(), fetchCopilotSettings: state.fetch, setCopilotPermission: state.permission, configureCopilot: state.configure }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let settings: CopilotSettings;
let client: QueryClient;
const targetId = "00000000-0000-4000-8000-000000000001";
function renderSettings() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CopilotAccessSettings users={[{ id: targetId, full_name: "Synthetic Operator", role: "opr" }]}/></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks(); state.role = "admin";
  settings = { config: { enabled: true, ai_enabled: false, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" },
    roles: [{ role: "opr", allowed: false }], users: [], usage: { requests: 0, reservedCents: 0, inputTokens: 0, outputTokens: 0, unavailable: 0 } };
  state.fetch.mockImplementation(async () => settings);
  state.permission.mockImplementation(async (role, id, allowed) => {
    settings = { ...settings, roles: role ? settings.roles.map((r) => r.role === role ? { ...r, allowed } : r) : settings.roles,
      users: id ? allowed === null ? [] : [{ user_id: id, allowed }] : settings.users };
    return { saved: true };
  });
  state.configure.mockImplementation(async (config) => { settings = { ...settings, config }; return { saved: true }; });
});
afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); });
describe("Admin Copilot feature access", () => {
  it("does not load settings or offer controls to a non-admin", () => {
    state.role = "cs_admin"; renderSettings();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it("saves a role default and refreshes its effective state", async () => {
    renderSettings(); const control = await screen.findByRole("switch", { name: "Allow Copilot for Operator" });
    await waitFor(() => expect(control).toBeEnabled());
    expect(control).not.toBeChecked(); fireEvent.click(control);
    await waitFor(() => expect(control).toBeChecked());
    expect(state.permission).toHaveBeenCalledWith("opr", null, true);
    expect(toast.success).toHaveBeenCalled();
  });
  it("retains the current permission and reports a failed save", async () => {
    state.permission.mockRejectedValue(new Error("Permission denied")); renderSettings();
    const control = await screen.findByRole("switch", { name: "Allow Copilot for Operator" });
    await waitFor(() => expect(control).toBeEnabled()); fireEvent.click(control);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Permission denied"));
    expect(control).not.toBeChecked(); expect(toast.success).not.toHaveBeenCalled();
  });
  it("acknowledges a successful save even if the following refresh fails", async () => {
    renderSettings(); const control = await screen.findByRole("switch", { name: "Allow Copilot for Operator" });
    await waitFor(() => expect(control).toBeEnabled()); state.fetch.mockRejectedValue(new Error("Refresh unavailable")); fireEvent.click(control);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marshmallow Copilot settings saved"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh unavailable"); expect(toast.error).not.toHaveBeenCalled();
  });
  it("saves global configuration explicitly, not on switch click", async () => {
    renderSettings(); const control = await screen.findByRole("switch", { name: "Enable Marshmallow Copilot globally" });
    fireEvent.click(control); expect(state.configure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Copilot configuration" }));
    await waitFor(() => expect(state.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, ai_enabled: false })));
  });
  it("enables AI and saves the shared allowance and daily cap only on explicit Save", async () => {
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" });
    await waitFor(() => expect(ai).toBeEnabled());
    fireEvent.click(ai);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }), { target: { value: "4.25" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "AI requests per user / day" }), { target: { value: "3" } });
    expect(state.configure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Copilot configuration" }));
    await waitFor(() => expect(state.configure).toHaveBeenCalledWith({ enabled: true, ai_enabled: true, monthly_budget_cents: 425, daily_ai_limit: 3, timezone: "America/New_York" }));
    expect(screen.getByRole("switch", { name: "Enable Marshmallow Copilot globally" })).toBeChecked();
    expect(screen.getByText(/There is no separate per-user AI permission/)).toBeInTheDocument();
  });
  it("preserves unsaved AI and budget edits when a role permission refreshes settings", async () => {
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" });
    await waitFor(() => expect(ai).toBeEnabled()); fireEvent.click(ai);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }), { target: { value: "5" } });
    const permission = screen.getByRole("switch", { name: "Allow Copilot for Operator" }); fireEvent.click(permission);
    await waitFor(() => expect(permission).toBeChecked());
    expect(ai).toBeChecked();
    expect(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" })).toHaveValue(5);
    expect(state.configure).not.toHaveBeenCalled();
  });
});
