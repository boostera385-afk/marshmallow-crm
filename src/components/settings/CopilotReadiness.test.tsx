import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CopilotReadiness from "./CopilotReadiness";
const state = vi.hoisted(() => ({ role: "admin", diagnostics: vi.fn(), test: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "synthetic-admin" }, role: state.role }) }));
vi.mock("@/lib/copilot-api", () => ({ fetchCopilotDiagnostics: state.diagnostics, testCopilotAi: state.test }));
let client: QueryClient;
function mount(ai = true) { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><CopilotReadiness config={{ enabled: true, ai_enabled: ai, monthly_budget_cents: 1000, daily_ai_limit: 20, timezone: "UTC" }}/></QueryClientProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); state.role = "admin";
  state.diagnostics.mockResolvedValue({ configChangedAt: null, lastSuccessAt: null, remainingCents: 1000, remainingToday: 20, completedThisMonth: 0, keyConfigured: true, backendVersion: "pilot-2", model: "gpt-4o-mini", promptVersion: "2026-10-14.1" });
  state.test.mockResolvedValue({ aiUsed: true });
});
afterEach(() => { cleanup(); client?.clear(); });
describe("Admin readiness and explicit provider consent", () => {
  it("does not expose or request diagnostics for an excluded role", () => { state.role = "processor"; mount(); expect(screen.queryByText("AI readiness")).not.toBeInTheDocument(); expect(state.diagnostics).not.toHaveBeenCalled(); });
  it("checks metadata only and makes a paid test only after confirmation", async () => {
    mount(); expect(state.diagnostics).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Check AI readiness" }));
    await screen.findByText("Present · not validated"); expect(state.test).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Test AI connection" })); expect(await screen.findByRole("alertdialog")).toHaveTextContent("$0.02");
    expect(state.test).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Confirm AI test" }));
    await screen.findByText("Provider test completed successfully."); expect(state.test).toHaveBeenCalledTimes(1);
  });
  it("does not permit a test when saved AI is disabled", async () => { mount(false); fireEvent.click(screen.getByRole("button", { name: "Check AI readiness" })); await screen.findByText("Present · not validated"); expect(screen.getByRole("button", { name: "Test AI connection" })).toBeDisabled(); });
  it("does not claim success or retry a failed provider test", async () => {
    state.test.mockRejectedValue(new Error("Provider billing blocked")); mount(); fireEvent.click(screen.getByRole("button", { name: "Check AI readiness" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Test AI connection" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Test AI connection" })); fireEvent.click(await screen.findByRole("button", { name: "Confirm AI test" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider billing blocked"); expect(state.test).toHaveBeenCalledTimes(1); expect(screen.queryByText("Provider test completed successfully.")).not.toBeInTheDocument();
  });
});
