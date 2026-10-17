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
    await waitFor(() => expect(state.configure).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, ai_enabled: false }), expect.objectContaining({ enabled: true, ai_enabled: false })));
  });
  it("enables AI and saves the shared allowance and daily cap only on explicit Save", async () => {
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" });
    await waitFor(() => expect(ai).toBeEnabled());
    fireEvent.click(ai);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }), { target: { value: "4.25" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "AI requests per user / day" }), { target: { value: "3" } });
    expect(state.configure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save Copilot configuration" }));
    await waitFor(() => expect(state.configure).toHaveBeenCalledWith({ enabled: true, ai_enabled: true, monthly_budget_cents: 425, daily_ai_limit: 3, timezone: "America/New_York" }, expect.objectContaining({ ai_enabled: false })));
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
  it.each([
    ["Monthly AI allowance (USD)", "-1"], ["Monthly AI allowance (USD)", "1001"],
    ["AI requests per user / day", "101"], ["AI requests per user / day", "1.5"],
    ["AI requests per user / day", ""],
  ])("prevents saving invalid %s: %s", async (name, value) => {
    renderSettings(); await screen.findByRole("spinbutton", { name });
    fireEvent.change(screen.getByRole("spinbutton", { name }), { target: { value } });
    expect(screen.getByRole("button", { name: "Save Copilot configuration" })).toBeDisabled();
    expect(state.configure).not.toHaveBeenCalled();
  });
  it("allows zero limits to pause AI and retains edits if configuration save fails", async () => {
    state.configure.mockRejectedValue(new Error("Configuration save denied")); renderSettings();
    const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" }); await waitFor(() => expect(ai).toBeEnabled());
    fireEvent.click(ai);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }), { target: { value: "0" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "AI requests per user / day" }), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Copilot configuration" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Configuration save denied"));
    expect(ai).toBeChecked(); expect(settings.config.ai_enabled).toBe(false);
    expect(state.configure).toHaveBeenCalledWith(expect.objectContaining({ monthly_budget_cents: 0, daily_ai_limit: 0 }), settings.config);
  });
  it("shows saved AI separately from an unsaved switch and discard restores saved values", async () => {
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" }); await waitFor(() => expect(ai).toBeEnabled());
    fireEvent.click(ai); expect(screen.getByText(/Saved: Copilot enabled · AI disabled · Unsaved changes/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft edits" })); expect(ai).not.toBeChecked(); expect(state.configure).not.toHaveBeenCalled();
  });
  it("preserves dirty drafts and blocks silent overwrites after another session changes config", async () => {
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" }); await waitFor(() => expect(ai).toBeEnabled()); fireEvent.click(ai);
    settings = { ...settings, config: { ...settings.config, daily_ai_limit: 3 } };
    await client.invalidateQueries({ queryKey: ["copilot-settings"] });
    expect(await screen.findByRole("alert")).toHaveTextContent("changed in another session"); expect(ai).toBeChecked();
    expect(screen.getByRole("button", { name: "Save Copilot configuration" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload saved configuration" }));
    expect(ai).not.toBeChecked(); expect(screen.getByRole("spinbutton", { name: "AI requests per user / day" })).toHaveValue(3); expect(state.configure).not.toHaveBeenCalled();
  });
  it("explains why AI off and unsaved Copilot off do not hide the assistant", async () => {
    renderSettings(); const global = await screen.findByRole("switch", { name: "Enable Marshmallow Copilot globally" });
    await waitFor(() => expect(global).toBeEnabled()); fireEvent.click(global);
    expect(screen.getByText(/Not applied yet/)).toHaveTextContent("Saving will hide Copilot for everyone");
    expect(screen.getByText(/controls paid AI answers only/)).toBeVisible();
    expect(settings.config.enabled).toBe(true); expect(state.configure).not.toHaveBeenCalled();
  });
  it("confirms and saves a global disable without silently saving unsaved AI or budget edits", async () => {
    settings.users = [{ user_id: targetId, allowed: true }];
    renderSettings(); const ai = await screen.findByRole("switch", { name: "Enable Copilot AI" }); await waitFor(() => expect(ai).toBeEnabled());
    fireEvent.click(ai); fireEvent.change(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Disable Copilot for everyone" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("users with an Allow override"); expect(state.configure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm disable for everyone" }));
    await waitFor(() => expect(settings.config.enabled).toBe(false));
    expect(state.configure).toHaveBeenCalledWith({ enabled: false, ai_enabled: false, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "America/New_York" }, expect.objectContaining({ enabled: true }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable Marshmallow Copilot globally" })).not.toBeChecked());
    expect(ai).toBeChecked(); expect(screen.getByRole("spinbutton", { name: "Monthly AI allowance (USD)" })).toHaveValue(5);
    expect(settings.users).toEqual([{ user_id: targetId, allowed: true }]); expect(state.permission).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not change saved access when the confirmed global disable fails", async () => {
    state.configure.mockRejectedValue(new Error("Global save failed")); renderSettings();
    const button = await screen.findByRole("button", { name: "Disable Copilot for everyone" }); await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button); fireEvent.click(screen.getByRole("button", { name: "Confirm disable for everyone" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Global save failed"));
    expect(settings.config.enabled).toBe(true); expect(screen.getByRole("switch", { name: "Enable Marshmallow Copilot globally" })).toBeChecked(); expect(toast.success).not.toHaveBeenCalled();
  });
  it("surfaces a role-denied user Allow and allows restoring role inheritance", async () => {
    settings.users = [{ user_id: targetId, allowed: true }]; renderSettings();
    await screen.findByText(/can keep Copilot visible even when a role is denied/);
    fireEvent.click(screen.getByRole("button", { name: "1 individual Allow · Review Operator overrides" }));
    expect(await screen.findByText("Effective access: Allowed")).toBeVisible();
    const override = screen.getByRole("combobox", { name: "Copilot override for Synthetic Operator" });
    fireEvent.keyDown(override, { key: "ArrowDown" }); fireEvent.click(screen.getByRole("option", { name: "Inherit role default" }));
    await waitFor(() => expect(state.permission).toHaveBeenCalledWith(null, targetId, null));
    await screen.findByText("Effective access: Denied"); expect(settings.users).toEqual([]);
  });
});
