import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/types";
import { toast } from "sonner";
import LeadCopyAccessSettings from "./LeadCopyAccessSettings";
import type { AccessUser } from "./FeatureAccessMatrix";
const state = vi.hoisted(() => ({ role: "admin" as AppRole, user: { id: "admin" }, fetch: vi.fn(), save: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => state }));
vi.mock("@/lib/operator-workflow", async (original) => ({ ...await original<typeof import("@/lib/operator-workflow")>(), fetchLeadCopySettings: state.fetch, setLeadCopyPermission: state.save }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const clients: QueryClient[] = [];
const users = [
  { id: "admin", full_name: "Workspace Admin", role: "admin" as const },
  { id: "operator", full_name: "Test Operator", role: "opr" as const },
  { id: "other", full_name: "Other Operator", role: "opr" as const },
];
function renderSettings(targets: AccessUser[] = users) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><LeadCopyAccessSettings users={targets} features={[
    { key: "leads", label: "All Leads", renderControl: () => "Allowed" },
    { key: "manual_lead", label: "Manual Lead", renderControl: () => "Not available" },
  ]} /></QueryClientProvider>);
}
const matrix = () => within(screen.getByRole("table"));
const control = () => matrix().getByRole("switch", { name: "Copy Details for Test Operator" });
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
  state.fetch.mockResolvedValue({ roles: [], users: [] });
  state.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

describe("single per-user Copy Details switch", () => {
  it("shows Copy Details once after Manual Lead, without a duplicate role/default editor", async () => {
    renderSettings();
    await waitFor(() => expect(control()).not.toBeDisabled());
    expect(matrix().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["User", "All Leads", "Manual Lead", "Copy Details"]);
    expect(matrix().getAllByRole("switch")).toHaveLength(2);
    expect(screen.getAllByRole("switch")).toHaveLength(4); // Same two users in desktop/mobile layouts, no extra role controls.
    expect(screen.queryByRole("heading", { name: "Copy Complete Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: /User overrides/ })).toBeNull();
    expect(matrix().queryByText("Workspace Admin")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Copy.*override/ })).toBeNull();
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("retains default-enabled copy access for %s without writing an override", async (role) => {
    renderSettings([{ id: "operator", full_name: "Test Operator", role }]);
    await waitFor(() => expect(control()).toBeChecked());
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each([
    { roleAllowed: false, override: undefined, allowed: false },
    { roleAllowed: true, override: false, allowed: false },
    { roleAllowed: false, override: true, allowed: true },
  ])("preserves saved role/user precedence: $roleAllowed / $override", async ({ roleAllowed, override, allowed }) => {
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: roleAllowed }], users: override === undefined ? [] : [{ user_id: "operator", allowed: override }] });
    renderSettings();
    await waitFor(() => expect(control()).not.toBeDisabled());
    expect(control()).toHaveAttribute("aria-checked", String(allowed));
    expect(state.save).not.toHaveBeenCalled();
  });
  it.each([true, false])("saves only the selected user's %s override and synchronizes desktop/mobile", async (allowed) => {
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: !allowed }], users: [] });
    renderSettings();
    await waitFor(() => expect(control()).not.toBeDisabled());
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: !allowed }], users: [{ user_id: "operator", allowed }] });
    fireEvent.click(control());
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith(null, "operator", allowed));
    await waitFor(() => expect(control()).toHaveAttribute("aria-checked", String(allowed)));
    const mobile = within(screen.getByRole("region", { name: "Feature access for Test Operator" }));
    expect(mobile.getByRole("switch", { name: "Copy Details for Test Operator" })).toHaveAttribute("aria-checked", String(allowed));
    expect(matrix().getByRole("switch", { name: "Copy Details for Other Operator" })).toHaveAttribute("aria-checked", String(!allowed));
    expect(toast.success).toHaveBeenCalledWith("Copy Complete Details access updated");
  });
  it("keeps the saved value and allows retry after a rejected mutation", async () => {
    state.save.mockRejectedValueOnce(new Error("Copy permission denied"));
    renderSettings();
    await waitFor(() => expect(control()).toBeChecked());
    fireEvent.click(control());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Copy permission denied"));
    expect(control()).toBeChecked();
    expect(toast.success).not.toHaveBeenCalled();
    state.fetch.mockResolvedValue({ roles: [], users: [{ user_id: "operator", allowed: false }] });
    fireEvent.click(control());
    await waitFor(() => expect(control()).not.toBeChecked());
    expect(state.save).toHaveBeenCalledTimes(2);
  });
  it("shows unverified access and recovers from a failed read without enabling fake defaults", async () => {
    state.fetch.mockRejectedValueOnce(new Error("Copy permissions unavailable"));
    renderSettings();
    expect(await screen.findByRole("alert")).toHaveTextContent("Copy permissions unavailable");
    expect(control()).toBeDisabled();
    expect(control()).not.toBeChecked();
    expect(control()).toHaveAttribute("title", "Copy access not verified");
    fireEvent.click(screen.getByRole("button", { name: "Retry permissions" }));
    await waitFor(() => expect(control()).not.toBeDisabled());
    expect(control()).toBeChecked();
    expect(state.save).not.toHaveBeenCalled();
  });
  it("acknowledges a successful save separately from a failed settings refresh", async () => {
    renderSettings();
    await waitFor(() => expect(control()).toBeChecked());
    state.fetch.mockRejectedValueOnce(new Error("Refresh unavailable"));
    fireEvent.click(control());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Copy Complete Details access updated"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh unavailable");
    expect(control()).toBeDisabled();
    expect(state.save).toHaveBeenCalledExactlyOnceWith(null, "operator", false);
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("does not offer default-on writes while the settings read is pending", () => {
    state.fetch.mockReturnValueOnce(new Promise(() => {}));
    renderSettings();
    expect(control()).toBeDisabled();
    expect(control()).not.toBeChecked();
    fireEvent.click(control());
    expect(state.save).not.toHaveBeenCalled();
  });
  it("guards repeated changes while a save is in flight and refreshes cached access", async () => {
    let finish!: () => void;
    state.save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderSettings();
    await waitFor(() => expect(control()).not.toBeDisabled());
    fireEvent.click(control());
    fireEvent.click(control());
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(control()).toBeDisabled();
    clients[0].setQueryData(["lead-copy-access", "operator", "opr"], true);
    state.fetch.mockResolvedValue({ roles: [], users: [{ user_id: "operator", allowed: false }] });
    await act(async () => finish());
    await waitFor(() => expect(control()).not.toBeDisabled());
    expect(control()).not.toBeChecked();
    expect(clients[0].getQueryState(["lead-copy-access", "operator", "opr"])?.isInvalidated).toBe(true);
  });
  it.each(["copy all details", "copy complete details", "copy details"])("keeps %s searchable as the single switch", async (search) => {
    renderSettings();
    await waitFor(() => expect(control()).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Find feature"), { target: { value: search } });
    expect(matrix().getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["User", "Copy Details"]);
    expect(control()).toBeChecked();
  });
  it.each(["processor", "customer_service", "cs_admin", "opr", "opr_admin"] as const)("does not expose settings or fetch permission data for %s", (role) => {
    state.role = role;
    renderSettings();
    expect(screen.queryByRole("table")).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });
});
