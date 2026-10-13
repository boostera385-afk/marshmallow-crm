import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
function renderSettings(withMatrix = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><LeadCopyAccessSettings users={[
    { id: "operator", full_name: "Test Operator", role: "opr" },
  ]} features={withMatrix ? [] : undefined} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "admin";
  state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: true }], users: [] });
  state.save.mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
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
    fireEvent.click(screen.getByRole("button", { name: /User overrides/ }));
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
  it("keeps the user list collapsed until requested and supports finding a specific user", async () => {
    renderSettings();
    expect(screen.queryByRole("combobox", { name: "Copy override for Test Operator" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /User overrides/ }));
    expect(await screen.findByRole("combobox", { name: "Copy override for Test Operator" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find user for Copy Details"), { target: { value: "Nobody" } });
    expect(screen.getByText(/No matching users/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Find user for Copy Details"), { target: { value: "operator" } });
    expect(screen.getByRole("combobox", { name: "Copy override for Test Operator" })).toBeInTheDocument();
  });
  it.each([
    ["Deny", false, "Denied"],
    ["Allow", true, "Allowed"],
    ["Inherit role default", null, "Denied"],
  ] as const)("saves a user %s choice and displays the effective access", async (choice, allowed, effective) => {
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: [{ user_id: "operator", allowed: true }] });
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /User overrides/ }));
    const control = screen.getByRole("combobox", { name: "Copy override for Test Operator" });
    await waitFor(() => expect(control).not.toBeDisabled());
    // Ensure the test changes the selected value, including an explicit Allow.
    if (choice === "Allow") {
      state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: [{ user_id: "operator", allowed: false }] });
      await clients[clients.length - 1].invalidateQueries({ queryKey: ["lead-copy-settings"] });
      await waitFor(() => expect(control).toHaveTextContent("Deny"));
    }
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: allowed === null ? [] : [{ user_id: "operator", allowed }] });
    fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: choice }));
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(null, "operator", allowed));
    await waitFor(() => expect(screen.getByText(`Operator · Effective access: ${effective}`)).toBeInTheDocument());
  });
  it.each(["copy all details", "copy complete details", "copy details"])("finds %s in the matrix and shows the saved override, not just the role default", async (search) => {
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: true }], users: [{ user_id: "operator", allowed: false }] });
    renderSettings(true);
    fireEvent.change(screen.getByLabelText("Find feature"), { target: { value: search } });
    const matrix = within(screen.getByRole("table"));
    expect(matrix.getByRole("columnheader", { name: "Copy All Details" })).toBeInTheDocument();
    await waitFor(() => expect(matrix.getByText("Effective access: Denied")).toBeInTheDocument());
    expect(matrix.getByRole("combobox", { name: "Copy All Details override for Test Operator" })).toHaveTextContent("Deny");
  });
  it("saves a matrix override through the copy RPC and keeps the separate panel in sync", async () => {
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: [] });
    renderSettings(true);
    const matrix = within(screen.getByRole("table"));
    const control = matrix.getByRole("combobox", { name: "Copy All Details override for Test Operator" });
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(matrix.getByText("Effective access: Denied")).toBeInTheDocument();
    state.fetch.mockResolvedValue({ roles: [{ role: "opr", allowed: false }], users: [{ user_id: "operator", allowed: true }] });
    fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Allow" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(null, "operator", true));
    await waitFor(() => expect(matrix.getByText("Effective access: Allowed")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /User overrides/ }));
    expect(screen.getByRole("combobox", { name: "Copy override for Test Operator" })).toHaveTextContent("Allow");
    expect(screen.getByText("Operator · Effective access: Allowed")).toBeInTheDocument();
  });
  it("does not change matrix access or report success after a rejected save", async () => {
    state.save.mockRejectedValue(new Error("Copy permission denied"));
    renderSettings(true);
    const matrix = within(screen.getByRole("table"));
    const control = matrix.getByRole("combobox", { name: "Copy All Details override for Test Operator" });
    await waitFor(() => expect(control).not.toBeDisabled());
    fireEvent.keyDown(control, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Deny" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Copy permission denied"));
    expect(control).toHaveTextContent("Inherit role default");
    expect(matrix.getByText("Effective access: Allowed")).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("disables matrix overrides and shows unverified access after a loading failure", async () => {
    state.fetch.mockRejectedValue(new Error("Copy permissions unavailable"));
    renderSettings(true);
    await screen.findByRole("alert");
    const matrix = within(screen.getByRole("table"));
    expect(matrix.getByText("Effective access: Not verified")).toBeInTheDocument();
    expect(matrix.getByRole("combobox", { name: "Copy All Details override for Test Operator" })).toBeDisabled();
  });
  it("does not expose the matrix copy editor to non-admin callers", () => {
    state.role = "cs_admin";
    renderSettings(true);
    expect(screen.queryByRole("table")).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
