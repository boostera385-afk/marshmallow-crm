import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Analytics from "./Analytics";

const state = vi.hoisted(() => ({
  role: "customer_service",
  grants: [] as string[],
  rpc: vi.fn(),
  from: vi.fn(),
  leads: [] as Record<string, unknown>[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "cs-user" }, canAccess: (item: string) => state.role === "admin" || state.grants.includes(item) }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: state.rpc, from: state.from } }));
vi.mock("@/lib/supabase-paginate", () => ({ fetchAllRows: async () => state.leads }));
vi.mock("@/lib/zipCentroids", () => ({ preloadZipDataset: async () => undefined }));
vi.mock("@/components/analytics/LeadCoverageSources", () => ({ LeadCoverageSources: () => null }));
vi.mock("recharts", () => ({ Bar: () => null, BarChart: () => null, CartesianGrid: () => null, Cell: () => null, ResponsiveContainer: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));

const teamRows = [
  { member_id: "u-b", member_name: "Bea", member_role: "customer_service", total_added: 3, engaged: 2, scheduled: 2, completed: 1 },
  { member_id: "u-d", member_name: "Dee", member_role: "cs_admin", total_added: "10", engaged: "9", scheduled: "4", completed: "2" },
  { member_id: "u-x", member_name: null, member_role: "customer_service", total_added: 0, engaged: 0, scheduled: 0, completed: 0 },
];
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Analytics /></QueryClientProvider>);
}
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
beforeEach(() => {
  state.role = "customer_service"; state.grants = []; state.leads = [];
  state.rpc.mockReset().mockResolvedValue({ data: teamRows, error: null });
  state.from.mockReset().mockImplementation(() => {
    const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return query;
  });
});
afterEach(cleanup);

describe("CS Team Performance access in Analytics", () => {
  it("shows only the CS Team Performance section, with team-wide counts, when Analytics is off", async () => {
    state.grants = ["cs_team_performance"];
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CS Team Performance");
    expect(screen.queryByRole("tablist", { name: "Analytics views" })).not.toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    await screen.findByText("Dee");
    expect(rows()).toEqual([
      ["Dee", "CS Admin", "10", "9", "4", "2", "20.0%"],
      ["Bea", "CS", "3", "2", "2", "1", "33.3%"],
      ["Unknown CS Agent", "CS", "0", "0", "0", "0", "0.0%"],
    ]);
    // One aggregate call; no lead rows, roles or profiles are read in the browser.
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.rpc.mock.calls[0][0]).toBe("cs_team_performance");
    expect(state.rpc.mock.calls[0][1]).toEqual({ p_start: expect.any(String), p_end: expect.any(String) });
    expect(state.from).not.toHaveBeenCalled();
  });

  it("reloads the team counts for a new date range", async () => {
    state.grants = ["cs_team_performance"];
    mount();
    await screen.findByText("Dee");
    fireEvent.click(screen.getByRole("button", { name: "7d" }));
    await vi.waitFor(() => expect(state.rpc).toHaveBeenCalledTimes(2));
    const [first, second] = state.rpc.mock.calls.map((call) => Date.parse(call[1].p_start));
    expect(second).toBeGreaterThan(first);
  });

  it("keeps the full page and the scoped report for Analytics without the CS grant", async () => {
    state.grants = ["analytics"];
    state.leads = [{ id: "l1", created_at: new Date().toISOString(), status: "paid", service_type: "x", number_name: null, assigned_cs: null, created_by: "cs-user" }];
    state.from.mockImplementation((table: string) => {
      const data = table === "user_roles" ? [{ user_id: "cs-user", role: "customer_service" }] : table === "profiles_public" ? [{ id: "cs-user", full_name: "Me" }] : [];
      const query = { select: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
      return query;
    });
    mount();
    expect(screen.getByRole("tablist", { name: "Analytics views" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "CS Team Performance" }));
    expect(await screen.findByText("Me")).toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "denied" }, "not enabled for your account"],
    [{ code: "500", message: "boom" }, "could not be loaded"],
  ])("reports a failed or denied load without claiming there were no leads", async (error, text) => {
    state.grants = ["cs_team_performance"];
    state.rpc.mockResolvedValue({ data: null, error });
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(screen.queryByText("No leads added by CS/Admin in this date range.")).not.toBeInTheDocument();
    state.rpc.mockResolvedValue({ data: teamRows, error: null });
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Dee")).toBeInTheDocument();
  });
});
